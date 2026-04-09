import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { plugins as pluginsTable, pluginJobRuns } from "@boringos/db";
import type { PluginRegistry } from "./plugin-system.js";
import { runPluginJob } from "./plugin-system.js";
import { generateId } from "@boringos/shared";

/**
 * Plugin webhook routes — receives inbound webhooks at /webhooks/plugins/:name/:event
 */
export function createPluginWebhookRoutes(db: Db, registry: PluginRegistry): Hono {
  const app = new Hono();

  app.post("/:pluginName/:event", async (c) => {
    const pluginName = c.req.param("pluginName");
    const event = c.req.param("event");

    const webhook = registry.getWebhookHandler(pluginName, event);
    if (!webhook) return c.json({ error: `No handler for ${pluginName}/${event}` }, 404);

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
    const body = await c.req.json().catch(() => ({}));
    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";

    // Get plugin config from DB
    const pluginRows = await db.select().from(pluginsTable).where(
      and(eq(pluginsTable.tenantId, tenantId), eq(pluginsTable.name, pluginName)),
    ).limit(1);
    const config = (pluginRows[0]?.config as Record<string, unknown>) ?? {};

    const response = await webhook.handler({ method: "POST", headers, body, tenantId, config });
    return c.json(response.body ?? { ok: true }, response.status as 200);
  });

  return app;
}

/**
 * Plugin admin routes — manage plugins, view job history
 */
export function createPluginAdminRoutes(db: Db, registry: PluginRegistry): Hono {
  const app = new Hono();

  // List available plugins
  app.get("/", (c) => {
    const list = registry.list().map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      jobs: p.jobs?.map((j) => ({ name: j.name, schedule: j.schedule })) ?? [],
      webhooks: p.webhooks?.map((w) => ({ event: w.event })) ?? [],
    }));
    return c.json({ plugins: list });
  });

  // Get plugin job history
  app.get("/:name/jobs", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id") ?? "";
    const rows = await db.select().from(pluginJobRuns)
      .where(and(eq(pluginJobRuns.tenantId, tenantId), eq(pluginJobRuns.pluginName, c.req.param("name"))))
      .orderBy(desc(pluginJobRuns.startedAt))
      .limit(50);
    return c.json({ jobs: rows });
  });

  // Trigger a plugin job manually
  app.post("/:name/jobs/:jobName/trigger", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id") ?? "";
    const plugin = registry.get(c.req.param("name"));
    if (!plugin) return c.json({ error: "Plugin not found" }, 404);

    const job = plugin.jobs?.find((j) => j.name === c.req.param("jobName"));
    if (!job) return c.json({ error: "Job not found" }, 404);

    const pluginRows = await db.select().from(pluginsTable).where(
      and(eq(pluginsTable.tenantId, tenantId), eq(pluginsTable.name, plugin.name)),
    ).limit(1);
    const config = (pluginRows[0]?.config as Record<string, unknown>) ?? {};

    // Run async
    runPluginJob(db, plugin, job, tenantId, config).catch(() => {});

    return c.json({ triggered: true });
  });

  return app;
}

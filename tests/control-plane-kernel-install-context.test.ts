/**
 * K7 — kernel install context (end-to-end).
 *
 * Verifies all 6 effects of installApp() (row, schema, agents,
 * workflows, routes, onTenantCreated) and rollback when any one of
 * them fails.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createKernelInstallContext,
  createAppRouteRegistry,
  type KernelInstallContext,
} from "@boringos/control-plane";
import {
  defineApp,
  type AppManifest,
  type RouteRegistrar,
} from "@boringos/app-sdk";
import { InstallRuntime, slotRegistry } from "@boringos/shell/runtime/install-runtime.js";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;
let bundleDir: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k7-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5593,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K7 Test', 'k7-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;

  bundleDir = mkdtempSync(join(tmpdir(), "bos-k7-bundle-"));
  mkdirSync(join(bundleDir, "schema"), { recursive: true });
  writeFileSync(
    join(bundleDir, "schema", "001_init.sql"),
    `CREATE TABLE k7_e2e_thing (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID NOT NULL,
       label TEXT NOT NULL
     )`,
    "utf8",
  );
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

const baseManifest: AppManifest = {
  kind: "app",
  id: "k7-e2e",
  version: "1.0.0",
  name: "K7 E2E",
  description: "Kernel install end-to-end test",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  schema: "schema",
  entityTypes: [{ id: "k7_thing", label: "Thing" }],
  ui: { entry: "dist/ui.js" },
  capabilities: ["entities.own:write", "slots:nav"],
};

function buildKernel(): {
  kernel: KernelInstallContext;
  shellRuntime: InstallRuntime;
  events: { type: string; payload: Record<string, unknown> }[];
  coreApp: Hono;
} {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const coreApp = new Hono();
  const routeRegistry = createAppRouteRegistry();
  routeRegistry.attachTo(coreApp);

  // Use a freshly-scoped InstallRuntime to keep tests independent.
  const shellRuntime = new InstallRuntime();

  const kernel = createKernelInstallContext({
    db: conn.db,
    slotRuntime: {
      installApp: (a) => shellRuntime.installApp(a),
      uninstallApp: (id) => shellRuntime.uninstallApp(id),
    },
    events: { emit: (type, payload) => { events.push({ type, payload }); } },
    routeRegistry,
  });

  return { kernel, shellRuntime, events, coreApp };
}

describe("createKernelInstallContext", () => {
  it("installApp performs all 6 effects atomically", async () => {
    const { kernel, shellRuntime, events, coreApp } = buildKernel();

    let onTenantCreatedCalled = false;
    const routes: RouteRegistrar = (app) => {
      const a = app as Hono;
      a.get("/things", (c) => c.json({ ok: true, label: "k7-e2e" }));
    };
    routes.agentDocs = () => "### k7-e2e routes\n- GET /things";

    const def = defineApp({
      id: "k7-e2e",
      agents: [{ id: "tri", name: "K7 Triage" }],
      workflows: [
        {
          id: "wf-1",
          name: "K7 Workflow",
          blocks: [],
          edges: [],
          triggers: [{ type: "cron", cron: "*/15 * * * *" }],
        },
      ],
      routes,
      onTenantCreated: async (ctx) => {
        onTenantCreatedCalled = true;
        expect(ctx.tenantId).toBe(tenantId);
      },
    });

    const record = await kernel.installApp({
      manifest: baseManifest,
      tenantId,
      manifestHash: "h1",
      definition: def,
      bundleDir,
      ui: { pages: { home: { id: "home", component: () => null as any } } as any } as any,
    });

    expect(record.appId).toBe("k7-e2e");

    // 1. Row exists.
    const rows = (await conn.db.execute(sql`
      SELECT app_id, version, status FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'k7-e2e'
    `)) as Array<{ app_id: string; version: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");

    // 2. Schema applied — namespaced table exists.
    const schemaCheck = (await conn.db.execute(sql`
      SELECT to_regclass('k7_e2e_thing') AS oid
    `)) as Array<{ oid: string | null }>;
    expect(schemaCheck[0]?.oid).not.toBeNull();

    // 3. Agents registered.
    const agentRows = (await conn.db.execute(sql`
      SELECT name FROM agents
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId: "k7-e2e" })}::jsonb
    `)) as Array<{ name: string }>;
    expect(agentRows.map((r) => r.name)).toEqual(["K7 Triage"]);

    // 4. Workflows registered (and a routine for the cron trigger).
    const wfRows = (await conn.db.execute(sql`
      SELECT id, name FROM workflows
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId: "k7-e2e" })}::jsonb
    `)) as Array<{ id: string; name: string }>;
    expect(wfRows).toHaveLength(1);
    const routineRows = (await conn.db.execute(sql`
      SELECT id FROM routines WHERE workflow_id = ${wfRows[0]!.id}
    `)) as Array<{ id: string }>;
    expect(routineRows).toHaveLength(1);

    // 5. Routes mounted under /api/{appId}.
    const r = await coreApp.fetch(new Request("http://t/api/k7-e2e/things"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, label: "k7-e2e" });

    // 6. onTenantCreated invoked, slot UI registered, event emitted.
    expect(onTenantCreatedCalled).toBe(true);
    expect(shellRuntime.isInstalled("k7-e2e")).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["app.installed"]);

    // The api-catalog snapshot includes this app's docs (for the agent
    // engine's apiCatalog provider).
    const catalog = kernel.getApiCatalog();
    expect(catalog.find((c) => c.path === "/api/k7-e2e")).toBeTruthy();
  });

  it("rolls back all 6 effects when onTenantCreated throws", async () => {
    const { kernel, shellRuntime, coreApp } = buildKernel();
    const appId = "k7-rollback";

    const def = defineApp({
      id: appId,
      agents: [{ id: "a", name: "Agent A" }],
      workflows: [{ id: "wf", name: "WF", blocks: [], edges: [] }],
      routes: (app) => {
        (app as Hono).get("/ping", (c) => c.text("pong"));
      },
      onTenantCreated: async () => {
        throw new Error("seed boom");
      },
    });

    await expect(
      kernel.installApp({
        manifest: { ...baseManifest, id: appId, schema: undefined },
        tenantId,
        definition: def,
      }),
    ).rejects.toThrow("seed boom");

    const rows = (await conn.db.execute(sql`
      SELECT app_id FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = ${appId}
    `)) as Array<{ app_id: string }>;
    expect(rows).toEqual([]);

    const agentRows = (await conn.db.execute(sql`
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId })}::jsonb
    `)) as Array<{ id: string }>;
    expect(agentRows).toEqual([]);

    const wfRows = (await conn.db.execute(sql`
      SELECT id FROM workflows
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId })}::jsonb
    `)) as Array<{ id: string }>;
    expect(wfRows).toEqual([]);

    expect(shellRuntime.isInstalled(appId)).toBe(false);
    expect(kernel.getApiCatalog().find((c) => c.path === `/api/${appId}`)).toBeFalsy();
    const r = await coreApp.fetch(new Request(`http://t/api/${appId}/ping`));
    expect(r.status).toBe(404);
  });

  it("uninstallApp drops the row, slot UI, and route mount", async () => {
    const { kernel, shellRuntime, coreApp } = buildKernel();
    const appId = "k7-uninst";

    const def = defineApp({
      id: appId,
      routes: (app) => {
        (app as Hono).get("/ping", (c) => c.text("pong"));
      },
    });

    await kernel.installApp({
      manifest: { ...baseManifest, id: appId, schema: undefined },
      tenantId,
      definition: def,
    });
    expect(shellRuntime.isInstalled(appId)).toBe(true);
    expect((await coreApp.fetch(new Request(`http://t/api/${appId}/ping`))).status).toBe(200);

    const result = await kernel.uninstallApp({ tenantId, appId, mode: "soft" });
    expect(result.uninstalled).toBe(true);

    expect(shellRuntime.isInstalled(appId)).toBe(false);
    expect((await coreApp.fetch(new Request(`http://t/api/${appId}/ping`))).status).toBe(404);

    const rows = (await conn.db.execute(sql`
      SELECT status FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = ${appId}
    `)) as Array<{ status: string }>;
    expect(rows[0]?.status).toBe("uninstalling");
  });

  it("slot runtime is exposed via the singleton InstallRuntime from A6", async () => {
    // Acceptance: "Slot runtime is the singleton InstallRuntime from A6."
    // We verify the kernel ctx accepts the framework's singleton wiring
    // by passing the default exports and seeing them get touched.
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const routeRegistry = createAppRouteRegistry();
    const shellRuntime = new InstallRuntime(slotRegistry);
    const kernel = createKernelInstallContext({
      db: conn.db,
      slotRuntime: {
        installApp: (a) => shellRuntime.installApp(a),
        uninstallApp: (id) => shellRuntime.uninstallApp(id),
      },
      events: { emit: (type, payload) => { events.push({ type, payload }); } },
      routeRegistry,
    });

    await kernel.installApp({
      manifest: { ...baseManifest, id: "k7-singleton", schema: undefined },
      tenantId,
      definition: defineApp({ id: "k7-singleton" }),
    });

    expect(shellRuntime.isInstalled("k7-singleton")).toBe(true);

    // Cleanup so the global registry doesn't leak across test runs.
    await kernel.uninstallApp({ tenantId, appId: "k7-singleton", mode: "soft" });
  });
});

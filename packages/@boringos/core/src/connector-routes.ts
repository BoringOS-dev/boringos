import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import type { ConnectorRegistry, EventBus, ActionRunner, ConnectorCredentials } from "@boringos/connector";
import { verifyCallbackToken } from "@boringos/agent";

export function createConnectorRoutes(
  db: Db,
  registry: ConnectorRegistry,
  eventBus: EventBus,
  actionRunner: ActionRunner,
  jwtSecret: string,
): Hono {
  const app = new Hono();

  // POST /webhooks/:kind — incoming webhook from external service
  app.post("/webhooks/:kind", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector) return c.json({ error: `Unknown connector: ${kind}` }, 404);
    if (!connector.handleWebhook) return c.json({ error: "Connector does not support webhooks" }, 400);

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
    const body = await c.req.json().catch(() => ({}));

    // Determine tenantId from query param or header
    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";

    const response = await connector.handleWebhook({
      method: "POST",
      headers,
      body,
      tenantId,
    });

    // Emit events
    if (response.events) {
      for (const event of response.events) {
        await eventBus.emit(event);
      }
    }

    return c.json(response.body ?? { ok: true }, response.status as 200);
  });

  // POST /actions/:kind/:action — agent invokes a connector action (JWT authenticated)
  app.post("/actions/:kind/:action", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }
    const claims = verifyCallbackToken(authHeader.slice(7), jwtSecret);
    if (!claims) return c.json({ error: "Invalid or expired token" }, 401);

    const kind = c.req.param("kind");
    const action = c.req.param("action");
    const body = await c.req.json() as Record<string, unknown>;

    // Fetch connector credentials from DB
    const rows = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.tenantId, claims.tenant_id), eq(connectors.kind, kind)))
      .limit(1);

    const connectorRow = rows[0];
    if (!connectorRow) return c.json({ error: `Connector ${kind} not configured for this tenant` }, 404);

    const credentials: ConnectorCredentials = {
      accessToken: (connectorRow.credentials as Record<string, string>)?.accessToken ?? "",
      refreshToken: (connectorRow.credentials as Record<string, string>)?.refreshToken,
      config: connectorRow.config as Record<string, unknown>,
    };

    const result = await actionRunner.execute(
      { connectorKind: kind, action, tenantId: claims.tenant_id, agentId: claims.agent_id, inputs: body },
      credentials,
    );

    return c.json(result, result.success ? 200 : 400);
  });

  // GET /connectors — list available connectors and their capabilities
  app.get("/connectors", (c) => {
    const list = registry.list().map((conn) => ({
      kind: conn.kind,
      name: conn.name,
      description: conn.description,
      events: conn.events,
      actions: conn.actions,
      hasOAuth: !!conn.oauth,
    }));
    return c.json({ connectors: list });
  });

  return app;
}

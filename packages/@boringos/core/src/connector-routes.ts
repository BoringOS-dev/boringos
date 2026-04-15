import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import type { ConnectorRegistry, EventBus, ActionRunner, ConnectorCredentials } from "@boringos/connector";
import { createOAuthManager } from "@boringos/connector";
import { verifyCallbackToken } from "@boringos/agent";
import { generateId } from "@boringos/shared";

export function createConnectorRoutes(
  db: Db,
  registry: ConnectorRegistry,
  eventBus: EventBus,
  actionRunner: ActionRunner,
  jwtSecret: string,
  baseUrl: string,
): Hono {
  const app = new Hono();

  // ── OAuth ────────────────────────────────────────────────────────────────

  // GET /oauth/:kind/authorize — start OAuth flow
  app.get("/oauth/:kind/authorize", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector) return c.json({ error: `Unknown connector: ${kind}` }, 404);
    if (!connector.oauth) return c.json({ error: `Connector ${kind} does not support OAuth` }, 400);

    // Resolve tenant from session or header
    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";
    if (!tenantId) return c.json({ error: "tenantId required" }, 400);

    const config = connector.oauth;
    const clientId = (connector as any).clientId ?? c.req.query("clientId") ?? "";
    const clientSecret = (connector as any).clientSecret ?? "";

    const oauth = createOAuthManager(config, clientId, clientSecret);
    // Use X-Forwarded-Proto/Host for public URL, fallback to baseUrl
    const proto = c.req.header("X-Forwarded-Proto") ?? "http";
    const host = c.req.header("Host") ?? new URL(baseUrl).host;
    const publicBase = `${proto}://${host}`;
    const redirectUri = `${publicBase}/api/connectors/oauth/${kind}/callback`;
    const state = `${tenantId}:${generateId().slice(0, 8)}`;
    const url = oauth.getAuthorizationUrl(redirectUri, state);

    return c.redirect(url);
  });

  // GET /oauth/:kind/callback — OAuth callback from provider
  app.get("/oauth/:kind/callback", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector?.oauth) return c.text("Unknown or non-OAuth connector", 400);

    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    const error = c.req.query("error");

    if (error) return c.text(`OAuth error: ${error}`, 400);
    if (!code) return c.text("Missing authorization code", 400);

    const tenantId = state.split(":")[0];
    if (!tenantId) return c.text("Invalid state parameter", 400);

    const config = connector.oauth;
    const clientId = (connector as any).clientId ?? "";
    const clientSecret = (connector as any).clientSecret ?? "";

    const oauth = createOAuthManager(config, clientId, clientSecret);
    const proto = c.req.header("X-Forwarded-Proto") ?? "http";
    const host = c.req.header("Host") ?? new URL(baseUrl).host;
    const publicBase = `${proto}://${host}`;
    const redirectUri = `${publicBase}/api/connectors/oauth/${kind}/callback`;

    try {
      const tokens = await oauth.exchangeCode(code, redirectUri);

      // Upsert connector credentials
      const existing = await db.select().from(connectors)
        .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, kind)))
        .limit(1);

      if (existing[0]) {
        await db.update(connectors).set({
          credentials: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt?.toISOString(),
          },
          status: "active",
          updatedAt: new Date(),
        }).where(eq(connectors.id, existing[0].id));
      } else {
        await db.insert(connectors).values({
          id: generateId(),
          tenantId,
          kind,
          status: "active",
          config: {},
          credentials: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt?.toISOString(),
          },
        });
      }

      // Emit connector.connected event
      await eventBus.emit({
        connectorKind: kind,
        type: "connector.connected",
        tenantId,
        data: { kind },
        timestamp: new Date(),
      }).catch(() => {});

      // Redirect back to frontend settings page
      // Derive frontend URL: replace "crmapi." with "crm." or use same origin
      const frontendBase = publicBase.replace("://crmapi.", "://crm.").replace("://api.", "://");
      return c.redirect(`${frontendBase}/settings/team?connected=${kind}`);
    } catch (err) {
      return c.text(`OAuth token exchange failed: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  });

  // ── Connector management ─────────────────────────────────────────────────

  // GET /status — list connector status for tenant (session authenticated)
  app.get("/status", async (c) => {
    const tenantId = c.req.header("X-Tenant-Id") ?? "";

    // If no tenant from header, resolve from session
    if (!tenantId) {
      const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
      if (!bearer) return c.json({ error: "Authentication required" }, 401);

      const result = await db.execute(sql`
        SELECT ut.tenant_id FROM auth_sessions s
        JOIN user_tenants ut ON ut.user_id = s.user_id
        WHERE s.token = ${bearer} AND s.expires_at > NOW() LIMIT 1
      `);
      const rows = result as unknown as Array<{ tenant_id: string }>;
      if (!rows[0]) return c.json({ error: "Invalid session" }, 401);

      const tid = rows[0].tenant_id;

      // Get connected connectors for tenant
      const connected = await db.select().from(connectors).where(eq(connectors.tenantId, tid));

      // Get all registered connectors
      const available = registry.list().map((conn) => {
        const match = connected.find((c) => c.kind === conn.kind);
        return {
          kind: conn.kind,
          name: conn.name,
          description: conn.description,
          hasOAuth: !!conn.oauth,
          connected: !!match,
          status: match?.status ?? "not_connected",
          lastSyncAt: match?.lastSyncAt,
        };
      });

      return c.json({ connectors: available, tenantId: tid });
    }

    const connected = await db.select().from(connectors).where(eq(connectors.tenantId, tenantId));
    const available = registry.list().map((conn) => {
      const match = connected.find((c) => c.kind === conn.kind);
      return {
        kind: conn.kind,
        name: conn.name,
        description: conn.description,
        hasOAuth: !!conn.oauth,
        connected: !!match,
        status: match?.status ?? "not_connected",
        lastSyncAt: match?.lastSyncAt,
      };
    });

    return c.json({ connectors: available, tenantId });
  });

  // POST /disconnect/:kind — disconnect a connector
  app.post("/disconnect/:kind", async (c) => {
    const kind = c.req.param("kind");
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) return c.json({ error: "Authentication required" }, 401);

    const result = await db.execute(sql`
      SELECT ut.tenant_id, ut.role FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer} AND s.expires_at > NOW() LIMIT 1
    `);
    const rows = result as unknown as Array<{ tenant_id: string; role: string }>;
    if (!rows[0]) return c.json({ error: "Invalid session" }, 401);
    if (rows[0].role !== "admin") return c.json({ error: "Admin only" }, 403);

    await db.delete(connectors)
      .where(and(eq(connectors.tenantId, rows[0].tenant_id), eq(connectors.kind, kind)));

    return c.json({ ok: true });
  });

  // ── Webhooks ─────────────────────────────────────────────────────────────

  // POST /webhooks/:kind — incoming webhook from external service
  app.post("/webhooks/:kind", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector) return c.json({ error: `Unknown connector: ${kind}` }, 404);
    if (!connector.handleWebhook) return c.json({ error: "Connector does not support webhooks" }, 400);

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
    const body = await c.req.json().catch(() => ({}));

    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";

    const response = await connector.handleWebhook({
      method: "POST",
      headers,
      body,
      tenantId,
    });

    if (response.events) {
      for (const event of response.events) {
        await eventBus.emit(event);
      }
    }

    return c.json(response.body ?? { ok: true }, response.status as 200);
  });

  // ── Actions ──────────────────────────────────────────────────────────────

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

    const resultData = await actionRunner.execute(
      { connectorKind: kind, action, tenantId: claims.tenant_id, agentId: claims.agent_id, inputs: body },
      credentials,
    );

    return c.json(resultData, resultData.success ? 200 : 400);
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

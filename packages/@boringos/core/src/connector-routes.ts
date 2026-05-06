import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors } from "@boringos/db";
import type { ConnectorRegistry, EventBus, ActionRunner, ConnectorCredentials } from "@boringos/connector";
import { createOAuthManager, createState, verifyState, isSafeReturnTo } from "@boringos/connector";
import { verifyCallbackToken } from "@boringos/agent";
import { generateId } from "@boringos/shared";
import { installDefaultWorkflows, pauseDefaultWorkflows } from "./connectors/post-connect.js";

/** What an OAuth-capable connector ships alongside its definition. */
interface OAuthCredentialed {
  clientId?: string;
  clientSecret?: string;
}

function readOAuthClient(connector: unknown): { clientId: string; clientSecret: string } {
  const c = connector as OAuthCredentialed;
  return {
    clientId: c.clientId ?? "",
    clientSecret: c.clientSecret ?? "",
  };
}

function publicOrigin(c: { req: { header: (k: string) => string | undefined } }, fallback: string): string {
  const proto = c.req.header("X-Forwarded-Proto") ?? "http";
  const host = c.req.header("Host") ?? new URL(fallback).host;
  return `${proto}://${host}`;
}

export interface ConnectorRoutesOptions {
  /**
   * Absolute origin where the shell SPA lives (e.g. http://localhost:5174 in
   * dev). Used as the default returnTo when the caller doesn't pass one,
   * and added to the allowlist for returnTo validation.
   */
  shellOrigin?: string;
}

export function createConnectorRoutes(
  db: Db,
  registry: ConnectorRegistry,
  eventBus: EventBus,
  actionRunner: ActionRunner,
  jwtSecret: string,
  baseUrl: string,
  opts: ConnectorRoutesOptions = {},
): Hono {
  const app = new Hono();
  const shellOrigin =
    opts.shellOrigin ?? process.env.BORINGOS_SHELL_URL ?? "";

  function buildAllowedReturnOrigins(callerOrigin: string): string[] {
    const list = new Set<string>([callerOrigin]);
    if (shellOrigin) list.add(shellOrigin);
    try {
      list.add(new URL(baseUrl).origin);
    } catch {
      /* ignore */
    }
    return Array.from(list);
  }

  function resolveReturnTo(rawReturnTo: string | undefined, callerOrigin: string): string {
    const fallback = `${shellOrigin || callerOrigin}/connectors`;
    if (!rawReturnTo) return fallback;
    if (isSafeReturnTo(rawReturnTo, buildAllowedReturnOrigins(callerOrigin))) {
      return rawReturnTo.startsWith("/")
        ? `${shellOrigin || callerOrigin}${rawReturnTo}`
        : rawReturnTo;
    }
    return fallback;
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  // GET /oauth/:kind/authorize — start OAuth flow
  app.get("/oauth/:kind/authorize", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector) return c.json({ error: `Unknown connector: ${kind}` }, 404);
    if (!connector.oauth) return c.json({ error: `Connector ${kind} does not support OAuth` }, 400);

    const tenantId = c.req.query("tenantId") ?? c.req.header("X-Tenant-Id") ?? "";
    if (!tenantId) return c.json({ error: "tenantId required" }, 400);

    const { clientId, clientSecret } = readOAuthClient(connector);
    if (!clientId) {
      return c.json(
        {
          error: `Connector ${kind} is missing clientId. Set it when registering the connector with the framework.`,
        },
        500,
      );
    }

    const callerOrigin = publicOrigin(c, baseUrl);
    const returnTo = resolveReturnTo(c.req.query("returnTo"), callerOrigin);

    const oauth = createOAuthManager(connector.oauth, clientId, clientSecret);
    const redirectUri = `${callerOrigin}/api/connectors/oauth/${kind}/callback`;
    const state = createState({ tenantId, returnTo }, jwtSecret);
    const url = oauth.getAuthorizationUrl(redirectUri, state);

    return c.redirect(url);
  });

  // GET /oauth/:kind/callback — OAuth callback from provider
  app.get("/oauth/:kind/callback", async (c) => {
    const kind = c.req.param("kind");
    const connector = registry.get(kind);
    if (!connector?.oauth) return c.text("Unknown or non-OAuth connector", 400);

    const code = c.req.query("code");
    const stateRaw = c.req.query("state") ?? "";
    const error = c.req.query("error");

    const callerOrigin = publicOrigin(c, baseUrl);
    const fallbackReturn = `${shellOrigin || callerOrigin}/connectors`;

    if (error) {
      return c.redirect(
        `${fallbackReturn}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(error)}`,
      );
    }
    if (!code) {
      return c.redirect(
        `${fallbackReturn}?connect=error&kind=${encodeURIComponent(kind)}&reason=missing_code`,
      );
    }

    const verified = verifyState(stateRaw, jwtSecret);
    if (!verified.ok || !verified.payload) {
      return c.redirect(
        `${fallbackReturn}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(verified.reason ?? "bad_state")}`,
      );
    }
    const { tenantId, returnTo } = verified.payload;

    const { clientId, clientSecret } = readOAuthClient(connector);
    if (!clientId) {
      return c.redirect(
        `${fallbackReturn}?connect=error&kind=${encodeURIComponent(kind)}&reason=missing_client_id`,
      );
    }

    const oauth = createOAuthManager(connector.oauth, clientId, clientSecret);
    const redirectUri = `${callerOrigin}/api/connectors/oauth/${kind}/callback`;

    try {
      const tokens = await oauth.exchangeCode(code, redirectUri);

      const existing = await db.select().from(connectors)
        .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, kind)))
        .limit(1);

      const credentialBag = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt?.toISOString(),
      };

      if (existing[0]) {
        await db.update(connectors).set({
          credentials: credentialBag,
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
          credentials: credentialBag,
        });
      }

      // N5 — install (or resume) the connector's default workflows.
      // Best-effort: a failure here shouldn't prevent the user from
      // reaching the success page. If install partially fails the
      // user can re-trigger from the connector card later.
      try {
        await installDefaultWorkflows(db, tenantId, connector);
      } catch (err) {
        console.warn(
          `[connector ${kind}] default workflow install failed for tenant ${tenantId}:`,
          err,
        );
      }

      await eventBus
        .emit({
          connectorKind: kind,
          type: "connector.connected",
          tenantId,
          data: { kind },
          timestamp: new Date(),
        })
        .catch(() => {});

      const redirectTo = `${returnTo}${returnTo.includes("?") ? "&" : "?"}connect=success&kind=${encodeURIComponent(kind)}`;
      return c.redirect(redirectTo);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return c.redirect(
        `${fallbackReturn}?connect=error&kind=${encodeURIComponent(kind)}&reason=${encodeURIComponent(reason)}`,
      );
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
        oauthScopes: conn.oauth?.scopes ?? [],
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

    // N6 — pause the connector's default workflows but keep them around
    // so a reconnect resumes cleanly. Best-effort; the disconnect
    // should still succeed even if pause fails.
    try {
      await pauseDefaultWorkflows(db, rows[0].tenant_id, kind);
    } catch (err) {
      console.warn(
        `[connector ${kind}] default workflow pause failed:`,
        err,
      );
    }

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

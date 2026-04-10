import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * Connector-action block handler — calls a connector action from within a workflow.
 * Auto-refreshes OAuth tokens on failure and retries once.
 *
 * Config:
 *   connectorKind: string (required) — e.g., "google", "slack"
 *   action: string (required) — e.g., "list_emails", "send_message"
 *   inputs?: Record<string, unknown> — action inputs
 *
 * Requires "actionRunner" and "db" in services.
 * Optionally uses "connectorRegistry" for OAuth config to refresh tokens.
 */
export const connectorActionHandler: BlockHandler = {
  types: ["connector-action"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const { connectorKind, action, inputs } = ctx.config as {
      connectorKind?: string;
      action?: string;
      inputs?: Record<string, unknown>;
    };

    if (!connectorKind || !action) {
      return {
        output: { success: false, error: "connectorKind and action are required" },
      };
    }

    const actionRunner = ctx.services.get<{
      execute(
        request: { connectorKind: string; action: string; tenantId: string; agentId: string; inputs: Record<string, unknown> },
        credentials: { accessToken: string; refreshToken?: string; config?: Record<string, unknown> },
      ): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
    }>("actionRunner");

    if (!actionRunner) {
      return { output: { success: false, error: "actionRunner not available in services" } };
    }

    const db = ctx.services.get<any>("db");
    if (!db) {
      return { output: { success: false, error: "db not available in services" } };
    }

    const { connectors } = await import("@boringos/db");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.tenantId, ctx.tenantId), eq(connectors.kind, connectorKind)))
      .limit(1);

    const connectorRow = rows[0];
    if (!connectorRow) {
      return {
        output: { success: false, error: `Connector ${connectorKind} not configured for tenant` },
      };
    }

    const creds = connectorRow.credentials as Record<string, string> | null;
    let accessToken = creds?.accessToken ?? "";
    const refreshToken = creds?.refreshToken;

    const request = {
      connectorKind,
      action,
      tenantId: ctx.tenantId,
      agentId: ctx.governingAgentId ?? "",
      inputs: inputs ?? {},
    };

    // First attempt
    let result = await actionRunner.execute(request, {
      accessToken,
      refreshToken,
      config: connectorRow.config as Record<string, unknown>,
    });

    // If failed and we have a refresh token, try refreshing
    if (!result.success && refreshToken && result.error?.includes("401")) {
      const newToken = await tryRefreshToken(connectorKind, refreshToken, creds);
      if (newToken) {
        // Update stored credentials
        await db.update(connectors).set({
          credentials: { ...creds, accessToken: newToken.accessToken, expiresAt: newToken.expiresAt },
          updatedAt: new Date(),
        }).where(eq(connectors.id, connectorRow.id));

        // Retry with new token
        result = await actionRunner.execute(request, {
          accessToken: newToken.accessToken,
          refreshToken,
          config: connectorRow.config as Record<string, unknown>,
        });
      }
    }

    // Flatten: merge result.data into output so {{blockName.field}} works for data fields
    const output: Record<string, unknown> = { success: result.success, error: result.error };
    if (result.data) {
      for (const [k, v] of Object.entries(result.data)) {
        output[k] = v;
      }
    }
    return { output };
  },
};

/**
 * Try to refresh an OAuth token using the standard token endpoint.
 * Returns new access token or null on failure.
 */
async function tryRefreshToken(
  connectorKind: string,
  refreshToken: string,
  creds: Record<string, string> | null,
): Promise<{ accessToken: string; expiresAt?: string } | null> {
  // Known token endpoints
  const tokenEndpoints: Record<string, string> = {
    google: "https://oauth2.googleapis.com/token",
    slack: "https://slack.com/api/oauth.v2.access",
  };

  const tokenUrl = tokenEndpoints[connectorKind];
  if (!tokenUrl) return null;

  // Get client credentials from env (connector config doesn't store secrets)
  const clientId = connectorKind === "google" ? process.env.GOOGLE_CLIENT_ID : "";
  const clientSecret = connectorKind === "google" ? process.env.GOOGLE_CLIENT_SECRET : "";
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    const expiresIn = data.expires_in as number | undefined;
    return {
      accessToken: data.access_token as string,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

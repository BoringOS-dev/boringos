import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * Connector-action block handler — calls a connector action from within a workflow.
 *
 * Config:
 *   connectorKind: string (required) — e.g., "google", "slack"
 *   action: string (required) — e.g., "list_emails", "send_message"
 *   inputs?: Record<string, unknown> — action inputs
 *
 * Output:
 *   { success: boolean, data?: Record<string, unknown>, error?: string }
 *
 * Requires "actionRunner" and "db" in services.
 * Fetches connector credentials from the DB for the workflow's tenant.
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

    // Fetch connector credentials from DB
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

    const credentials = {
      accessToken: (connectorRow.credentials as Record<string, string>)?.accessToken ?? "",
      refreshToken: (connectorRow.credentials as Record<string, string>)?.refreshToken,
      config: connectorRow.config as Record<string, unknown>,
    };

    const result = await actionRunner.execute(
      {
        connectorKind,
        action,
        tenantId: ctx.tenantId,
        agentId: ctx.governingAgentId ?? "",
        inputs: inputs ?? {},
      },
      credentials,
    );

    return { output: result };
  },
};

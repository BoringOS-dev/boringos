import type { Db } from "@boringos/db";
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * Wake-agent block handler — wakes an agent from within a workflow.
 *
 * Config:
 *   agentId: string  — the agent to wake (one of agentId/agentRole required)
 *   agentRole: string — alternative to agentId; resolves at runtime to the
 *                       first agent in this tenant with matching role.
 *                       Lets workflows be tenant-portable: seed once with
 *                       a role string, no need to bake in tenant-specific IDs.
 *   reason?: string — wake reason (default: "workflow_triggered")
 *   taskId?: string — optional task to associate with the wake
 *
 * Output:
 *   { outcome: string, wakeupRequestId?: string, agentId: string }
 *
 * Requires "agentEngine" in services. `agentRole` lookup also needs "db".
 */
export const wakeAgentHandler: BlockHandler = {
  types: ["wake-agent"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const { agentId: cfgAgentId, agentRole, reason, taskId } = ctx.config as {
      agentId?: string;
      agentRole?: string;
      reason?: string;
      taskId?: string;
    };

    let agentId = cfgAgentId;
    if (!agentId && agentRole) {
      const db = ctx.services.get<Db>("db");
      if (!db) return { output: { outcome: "error", error: "db service required for agentRole lookup" } };
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`
        SELECT id FROM agents
        WHERE tenant_id = ${ctx.tenantId} AND role = ${agentRole}
        LIMIT 1
      `) as unknown as Array<{ id: string }>;
      if (!rows[0]) {
        return { output: { outcome: "agent_not_found", error: `no agent with role "${agentRole}" in this tenant` } };
      }
      agentId = rows[0].id;
    }

    if (!agentId) {
      return { output: { outcome: "error", error: "agentId or agentRole is required" } };
    }

    // App-installed workflow templates reference agents by their
    // AppDefinition ID (e.g. "generic-replier.replier") rather than
    // the tenant-specific UUID assigned at install. K4's registrar
    // stores the templates verbatim — resolve here so workflow
    // templates stay tenant-portable.
    //
    // Heuristic: app-def-ids contain a dot ("app.agent"). Plain
    // identifiers without dots (test fixtures, role-based wakes) are
    // passed through to the engine unchanged — the engine then either
    // matches a UUID directly or surfaces its own "not found" error.
    const looksLikeAppDefId = agentId.includes(".");
    if (looksLikeAppDefId) {
      const db = ctx.services.get<Db>("db");
      if (db) {
        const { sql } = await import("drizzle-orm");
        const rows = (await db.execute(sql`
          SELECT id FROM agents
          WHERE tenant_id = ${ctx.tenantId}
            AND metadata->>'appAgentDefId' = ${agentId}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        if (!rows[0]) {
          return {
            output: {
              outcome: "agent_not_found",
              error: `no agent with appAgentDefId "${agentId}" in this tenant`,
            },
          };
        }
        agentId = rows[0].id;
      }
      // No db service: leave the value as-is and let the engine surface
      // the resulting error. This matches the pre-resolver behavior so
      // tests that mock the engine without a db keep working.
    }

    const engine = ctx.services.get<{
      wake(req: { agentId: string; tenantId: string; reason: string; taskId?: string }): Promise<{
        kind: string;
        wakeupRequestId?: string;
      }>;
      enqueue(wakeupRequestId: string): Promise<string>;
    }>("agentEngine");

    if (!engine) {
      return { output: { outcome: "error", error: "agentEngine not available in services" } };
    }

    const outcome = await engine.wake({
      agentId,
      tenantId: ctx.tenantId,
      reason: reason ?? "workflow_triggered",
      taskId,
    });

    if (outcome.kind === "created" && outcome.wakeupRequestId) {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return {
      output: {
        outcome: outcome.kind,
        wakeupRequestId: outcome.wakeupRequestId,
        agentId,
      },
    };
  },
};

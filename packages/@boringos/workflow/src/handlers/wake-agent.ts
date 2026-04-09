import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * Wake-agent block handler — wakes an agent from within a workflow.
 *
 * Config:
 *   agentId: string (required) — the agent to wake
 *   reason?: string — wake reason (default: "workflow_triggered")
 *   taskId?: string — optional task to associate with the wake
 *
 * Output:
 *   { outcome: string, wakeupRequestId?: string }
 *
 * Requires "agentEngine" in services.
 */
export const wakeAgentHandler: BlockHandler = {
  types: ["wake-agent"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const { agentId, reason, taskId } = ctx.config as {
      agentId?: string;
      reason?: string;
      taskId?: string;
    };

    if (!agentId) {
      return { output: { outcome: "error", error: "agentId is required" } };
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

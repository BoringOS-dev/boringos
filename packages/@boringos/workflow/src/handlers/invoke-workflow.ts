import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * `invoke-workflow` block — executes another workflow as a sub-routine.
 *
 * The caller waits for the child run to finish (or pause). The child's
 * final block outputs are merged into a single object and returned as
 * this block's output so downstream blocks can reference it. If the
 * child pauses at a wait-for-human, this block propagates the pause —
 * the parent run also pauses on the same action task.
 *
 * This is the composition primitive: shared sub-flows (e.g. "score a
 * lead", "draft a reply") become their own workflow and every caller
 * invokes them instead of duplicating block chains.
 *
 * Config:
 *   workflowId    — Required. ID of the workflow to execute.
 *   payload?      — Trigger payload to pass. Defaults to {} when omitted.
 *                   Template interpolation works here so you can forward
 *                   upstream state (e.g. `{{ fetch.messages }}`).
 *   triggerType?  — Defaults to "manual". Use "event" / "cron" etc. to
 *                   match what the child workflow's trigger expects.
 *
 * Output:
 *   { runId, status, output, error? }
 *
 * Requires "workflowEngine" in services.
 */
export const invokeWorkflowHandler: BlockHandler = {
  types: ["invoke-workflow"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const { workflowId, payload, triggerType } = ctx.config as {
      workflowId?: string;
      payload?: Record<string, unknown> | string;
      triggerType?: string;
    };

    if (!workflowId) {
      return { output: { error: "workflowId is required" } };
    }
    if (workflowId === ctx.workflowId) {
      return { output: { error: "invoke-workflow cannot call its own workflow (recursion guard)" } };
    }

    const engine = ctx.services.get<{
      execute: (id: string, trigger?: { type: string; data: Record<string, unknown> }) => Promise<{
        runId: string;
        status: string;
        blockResults: Map<string, { output: Record<string, unknown> }>;
        error?: string;
        awaitingActionTaskId?: string;
      }>;
    }>("workflowEngine");

    if (!engine) {
      return { output: { error: "workflowEngine service not available" } };
    }

    // payload may arrive as a JSON string after template resolution.
    let data: Record<string, unknown> = {};
    if (payload) {
      if (typeof payload === "string") {
        try { data = JSON.parse(payload) as Record<string, unknown>; } catch { data = {}; }
      } else {
        data = payload;
      }
    }

    const result = await engine.execute(workflowId, {
      type: triggerType ?? "manual",
      data,
    });

    // Flatten the child's block outputs into a single object so callers
    // can reference any block's output as {{invokeName.blockName}}.
    const childOutputs: Record<string, unknown> = {};
    for (const [blockId, blockResult] of result.blockResults.entries()) {
      childOutputs[blockId] = blockResult.output;
    }

    return {
      output: {
        runId: result.runId,
        status: result.status,
        error: result.error,
        awaitingActionTaskId: result.awaitingActionTaskId,
        ...childOutputs,
      },
    };
  },
};

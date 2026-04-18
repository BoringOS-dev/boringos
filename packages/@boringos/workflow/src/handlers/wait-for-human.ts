import type { Db } from "@boringos/db";
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * `wait-for-human` block — pauses a workflow until a human acts.
 *
 * Creates an entry in the Actions queue (`tasks` table with
 * `origin_kind='agent_action'` by default) referencing this workflow run,
 * then signals the engine to pause. When the user approves (or edits &
 * runs) the action card in the UI, the CRM's action executor calls
 * `engine.resume(runId, { userInput })`. The engine re-enters the run at
 * the paused block, marks it completed, and continues the DAG walk.
 *
 * Config:
 *   title           — (required) Title shown on the action card.
 *   description     — Short rationale.
 *   originKind      — "agent_action" (default) | "human_todo" | "agent_blocked"
 *   priority        — "low" | "medium" (default) | "high" | "urgent"
 *   assigneeUserId  — Specific user who must act. Defaults to whoever.
 *   proposedParams  — Payload shown in the action card editor. The
 *                     special key `kind: "resume_workflow"` is ALWAYS set
 *                     automatically; any other keys you provide are
 *                     preserved so your downstream blocks can read them
 *                     after resume.
 *
 * Output (available to downstream blocks after resume):
 *   { taskId, waiting: true, userInput: <object passed to resume()> }
 *
 * Example:
 *   {
 *     type: "wait-for-human",
 *     config: {
 *       title: "Approve reply draft to {{triage.sender}}",
 *       description: "High-score thread — score {{triage.score}}",
 *       proposedParams: { draft: "{{triage.draft}}", inboxItemId: "{{triage.itemId}}" }
 *     }
 *   }
 */
export const waitForHumanHandler: BlockHandler = {
  types: ["wait-for-human"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const db = ctx.services.get("db") as Db | undefined;
    if (!db) return { output: { error: "db service not available", waiting: false } };

    const cfg = ctx.config as {
      title?: string;
      description?: string;
      originKind?: string;
      priority?: string;
      assigneeUserId?: string;
      proposedParams?: Record<string, unknown> | string;
    };

    if (!cfg.title) {
      return { output: { error: "title is required", waiting: false } };
    }

    try {
      const { tasks } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      // proposedParams may arrive as JSON string via template resolution
      let userParams: Record<string, unknown> = {};
      if (cfg.proposedParams) {
        userParams = typeof cfg.proposedParams === "string"
          ? JSON.parse(cfg.proposedParams) as Record<string, unknown>
          : cfg.proposedParams;
      }

      // Always stamp the workflow-resume pointer so the Actions executor
      // knows to call `engine.resume()` instead of a normal action kind.
      const proposedParams: Record<string, unknown> = {
        ...userParams,
        kind: "resume_workflow",
        workflowRunId: ctx.workflowRunId,
        resumeFromBlockId: ctx.blockId,
      };

      const taskId = generateId();
      await db.insert(tasks).values({
        id: taskId,
        tenantId: ctx.tenantId,
        title: cfg.title,
        description: cfg.description,
        status: "todo",
        priority: cfg.priority ?? "medium",
        originKind: cfg.originKind ?? "agent_action",
        assigneeUserId: cfg.assigneeUserId,
        proposedParams,
      });

      // Signal the engine to pause. The actual `waiting` state + run-row
      // update happens in the engine once it sees `waitingForResume`.
      return {
        output: { taskId, waiting: true },
        waitingForResume: { taskId, reason: cfg.title },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: { error: msg, waiting: false } };
    }
  },
};

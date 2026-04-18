import type { Db } from "@boringos/db";
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * `create-task` block — creates a framework task.
 *
 * First-class workflow counterpart to `POST /api/agent/tasks` (which is
 * only callable from agent subprocesses). Workflows use this to turn an
 * event into a task that then triggers downstream agent work (via a
 * `wake-agent` block, or via the framework's comment_posted hook later).
 *
 * Config (all fields support template interpolation):
 *   title         — Required. Task title.
 *   description?  — Task description / rationale.
 *   status?       — "todo" (default) | "in_progress" | "blocked" | "done" | …
 *   priority?     — "low" | "medium" (default) | "high" | "urgent"
 *   originKind?   — Defaults to "workflow". Well-known: "agent_action",
 *                   "human_todo", "agent_blocked", "agent-meeting-prep", etc.
 *   originId?     — Opaque tracking id (e.g. Google event id for dedup).
 *   assigneeAgentId?  — Agent to route the work to.
 *   assigneeUserId?   — User to route the work to.
 *   parentId?     — Parent task id (links actions to their source).
 *   proposedParams?   — JSON payload for agent_action tasks (executor input).
 *
 * Output:
 *   { taskId, title }
 *   { error, taskId: null } on failure
 */
export const createTaskHandler: BlockHandler = {
  types: ["create-task"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const db = ctx.services.get("db") as Db | undefined;
    if (!db) return { output: { error: "db service not available", taskId: null } };

    const cfg = ctx.config as {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      originKind?: string;
      originId?: string;
      assigneeAgentId?: string;
      assigneeUserId?: string;
      parentId?: string;
      proposedParams?: Record<string, unknown> | string;
    };

    if (!cfg.title || typeof cfg.title !== "string") {
      return { output: { error: "title is required", taskId: null } };
    }

    try {
      const { tasks } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      // proposedParams may arrive as a JSON string after template resolution
      let proposedParams = cfg.proposedParams;
      if (typeof proposedParams === "string") {
        try { proposedParams = JSON.parse(proposedParams); } catch { proposedParams = undefined; }
      }

      const id = generateId();
      await db.insert(tasks).values({
        id,
        tenantId: ctx.tenantId,
        title: cfg.title,
        description: cfg.description,
        status: cfg.status ?? "todo",
        priority: cfg.priority ?? "medium",
        originKind: cfg.originKind ?? "workflow",
        originId: cfg.originId,
        assigneeAgentId: cfg.assigneeAgentId,
        assigneeUserId: cfg.assigneeUserId,
        parentId: cfg.parentId,
        proposedParams: proposedParams as Record<string, unknown> | undefined,
      });

      return { output: { taskId: id, title: cfg.title } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: { error: msg, taskId: null } };
    }
  },
};

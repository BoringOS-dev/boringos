import { eq, desc, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflowRuns, workflowBlockRuns } from "@boringos/db";
import { generateId } from "@boringos/shared";

export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type BlockRunStatus = "pending" | "running" | "completed" | "skipped" | "failed";
/** Run-level trigger source. Wider than `TriggerType` in types.ts which only covers workflow-definition trigger kinds. */
export type RunTriggerType = "cron" | "event" | "webhook" | "manual";

export interface CreateWorkflowRunInput {
  tenantId: string;
  workflowId: string;
  triggerType: RunTriggerType;
  triggerPayload?: Record<string, unknown>;
}

export interface UpdateWorkflowRunInput {
  status?: WorkflowRunStatus;
  error?: string | null;
  finishedAt?: Date;
  durationMs?: number;
}

export interface CreateBlockRunInput {
  workflowRunId: string;
  tenantId: string;
  blockId: string;
  blockName: string;
  blockType: string;
  status?: BlockRunStatus;
}

export interface UpdateBlockRunInput {
  status?: BlockRunStatus;
  resolvedConfig?: Record<string, unknown>;
  inputContext?: Record<string, unknown>;
  output?: Record<string, unknown>;
  selectedHandle?: string | null;
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}

export interface WorkflowRunRow {
  id: string;
  tenantId: string;
  workflowId: string;
  triggerType: string;
  triggerPayload: Record<string, unknown> | null;
  status: string;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlockRunRow extends CreateBlockRunInput {
  id: string;
  resolvedConfig: Record<string, unknown> | null;
  inputContext: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  selectedHandle: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence layer for workflow execution history. The engine writes
 * through this interface so runs + per-block execution details become
 * queryable via the admin API and visualizable in the workflow UI.
 *
 * Methods are best-effort: the engine never lets a persistence failure
 * kill a workflow run; errors bubble up but are logged and swallowed by
 * the engine's instrumentation wrapper.
 */
export interface WorkflowRunStore {
  createRun(input: CreateWorkflowRunInput): Promise<string>;
  updateRun(id: string, input: UpdateWorkflowRunInput): Promise<void>;
  createBlockRun(input: CreateBlockRunInput): Promise<string>;
  updateBlockRun(id: string, input: UpdateBlockRunInput): Promise<void>;
  listRuns(workflowId: string, opts?: { limit?: number }): Promise<WorkflowRunRow[]>;
  listRunsByTenant(tenantId: string, opts?: { limit?: number }): Promise<WorkflowRunRow[]>;
  getRun(id: string): Promise<WorkflowRunRow | null>;
  listBlockRuns(runId: string): Promise<BlockRunRow[]>;
}

export function createWorkflowRunStore(db: Db): WorkflowRunStore {
  return {
    async createRun(input) {
      const id = generateId();
      await db.insert(workflowRuns).values({
        id,
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        triggerType: input.triggerType,
        triggerPayload: input.triggerPayload,
        status: "queued",
      });
      return id;
    },

    async updateRun(id, input) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status !== undefined) values.status = input.status;
      if (input.error !== undefined) values.error = input.error;
      if (input.finishedAt !== undefined) values.finishedAt = input.finishedAt;
      if (input.durationMs !== undefined) values.durationMs = input.durationMs;
      await db.update(workflowRuns).set(values).where(eq(workflowRuns.id, id));
    },

    async createBlockRun(input) {
      const id = generateId();
      await db.insert(workflowBlockRuns).values({
        id,
        workflowRunId: input.workflowRunId,
        tenantId: input.tenantId,
        blockId: input.blockId,
        blockName: input.blockName,
        blockType: input.blockType,
        status: input.status ?? "pending",
      });
      return id;
    },

    async updateBlockRun(id, input) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status !== undefined) values.status = input.status;
      if (input.resolvedConfig !== undefined) values.resolvedConfig = input.resolvedConfig;
      if (input.inputContext !== undefined) values.inputContext = input.inputContext;
      if (input.output !== undefined) values.output = input.output;
      if (input.selectedHandle !== undefined) values.selectedHandle = input.selectedHandle;
      if (input.error !== undefined) values.error = input.error;
      if (input.startedAt !== undefined) values.startedAt = input.startedAt;
      if (input.finishedAt !== undefined) values.finishedAt = input.finishedAt;
      if (input.durationMs !== undefined) values.durationMs = input.durationMs;
      await db.update(workflowBlockRuns).set(values).where(eq(workflowBlockRuns.id, id));
    },

    async listRuns(workflowId, opts) {
      const limit = opts?.limit ?? 50;
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, workflowId))
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit);
      return rows as WorkflowRunRow[];
    },

    async listRunsByTenant(tenantId, opts) {
      const limit = opts?.limit ?? 50;
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.tenantId, tenantId))
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit);
      return rows as WorkflowRunRow[];
    },

    async getRun(id) {
      const rows = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
      return (rows[0] ?? null) as WorkflowRunRow | null;
    },

    async listBlockRuns(runId) {
      const rows = await db
        .select()
        .from(workflowBlockRuns)
        .where(eq(workflowBlockRuns.workflowRunId, runId))
        .orderBy(workflowBlockRuns.startedAt);
      return rows as BlockRunRow[];
    },
  };
}

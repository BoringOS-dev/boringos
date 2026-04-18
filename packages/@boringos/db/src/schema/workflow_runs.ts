import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { workflows } from "./workflows.js";

/**
 * One row per workflow execution. Captures what triggered it, overall status,
 * timing, and any top-level error. Each block execution lives in
 * `workflow_block_runs` linked via `workflow_run_id`.
 */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id),
    /** Human-readable source of the trigger: "cron" | "event" | "webhook" | "manual" */
    triggerType: text("trigger_type").notNull().default("manual"),
    /** The payload the workflow received (event data, cron tick, webhook body) */
    triggerPayload: jsonb("trigger_payload").$type<Record<string, unknown>>(),
    /** "queued" | "running" | "completed" | "failed" | "cancelled" */
    status: text("status").notNull().default("queued"),
    /** Optional error message when status=failed */
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowStartedIdx: index("workflow_runs_workflow_started_idx").on(table.workflowId, table.startedAt),
    tenantStartedIdx: index("workflow_runs_tenant_started_idx").on(table.tenantId, table.startedAt),
  }),
);

/**
 * One row per block execution within a workflow run. Captures the resolved
 * config (after template interpolation), the input context snapshot (what
 * upstream blocks produced), the block's output, branching decision, timing,
 * and any error. Lets the UI render a fully replayable DAG with per-node
 * drill-down.
 */
export const workflowBlockRuns = pgTable(
  "workflow_block_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    /** The block id from the workflow definition (not a DB id) */
    blockId: text("block_id").notNull(),
    blockName: text("block_name").notNull(),
    blockType: text("block_type").notNull(),
    /** "pending" | "running" | "completed" | "skipped" | "failed" */
    status: text("status").notNull().default("pending"),
    /** Config after `{{block.field}}` templates are resolved */
    resolvedConfig: jsonb("resolved_config").$type<Record<string, unknown>>(),
    /** Outputs of all upstream completed blocks, at the moment this block ran */
    inputContext: jsonb("input_context").$type<Record<string, unknown>>(),
    /** Whatever the handler returned */
    output: jsonb("output").$type<Record<string, unknown>>(),
    /** For conditional blocks: which branch was taken */
    selectedHandle: text("selected_handle"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("workflow_block_runs_run_idx").on(table.workflowRunId),
  }),
);

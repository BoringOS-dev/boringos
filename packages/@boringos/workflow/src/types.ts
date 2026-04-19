import type { Identifiable, TenantScoped, Timestamped } from "@boringos/shared";

// ── DAG types ────────────────────────────────────────────────────────────────

export interface DAGNode {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  incomingBlockIds: Set<string>;
  outgoingEdges: DAGEdge[];
}

export interface DAGEdge {
  targetBlockId: string;
  sourceHandle: string | null;
}

export interface DAG {
  nodes: Map<string, DAGNode>;
  startNodeId: string | null;
}

// ── Block handlers ───────────────────────────────────────────────────────────

export interface BlockHandler {
  types: string[];
  execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult>;
}

export interface BlockHandlerContext {
  blockId: string;
  blockName: string;
  blockType: string;
  config: Record<string, unknown>;
  workflowRunId: string;
  workflowId: string;
  tenantId: string;
  governingAgentId: string | null;
  workflowType: string;
  state: ExecutionState;
  services: ServiceAccessor;
}

export interface BlockHandlerResult {
  output: Record<string, unknown>;
  selectedHandle?: string;
  /**
   * When set, the engine pauses the workflow run at this block. The run
   * transitions to status `waiting_for_human` and stores `taskId` as the
   * awaiting-action pointer. The block's state is recorded as `"waiting"`.
   * Resume via `engine.resume(runId, { userInput })` — typically triggered
   * when the user approves the corresponding Actions-queue card.
   */
  waitingForResume?: {
    taskId: string;
    reason?: string;
  };
}

// ── Execution state ──────────────────────────────────────────────────────────

export interface ExecutionState {
  get(blockId: string): BlockState | undefined;
  set(blockId: string, state: BlockState): void;
  all(): Map<string, BlockState>;
}

export interface BlockState {
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "waiting";
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ── Service accessor — replaces direct db/hebbs injection ────────────────────

export interface ServiceAccessor {
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
}

// ── Workflow definition ──────────────────────────────────────────────────────

export interface WorkflowDefinition extends Identifiable, TenantScoped, Timestamped {
  name: string;
  type: "user" | "system";
  governingAgentId: string | null;
  blocks: BlockDefinition[];
  edges: EdgeDefinition[];
  status: WorkflowStatus;
}

export interface BlockDefinition {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface EdgeDefinition {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  sourceHandle: string | null;
  sortOrder: number;
}

export const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

// ── Workflow store ────────────────────────────────────────────────────────────

export interface WorkflowStore {
  get(id: string): Promise<WorkflowDefinition | null>;
  list(tenantId: string): Promise<WorkflowDefinition[]>;
  create(input: CreateWorkflowInput): Promise<WorkflowDefinition>;
  update(id: string, input: UpdateWorkflowInput): Promise<WorkflowDefinition>;
  delete(id: string): Promise<void>;
}

export interface CreateWorkflowInput {
  tenantId: string;
  name: string;
  type?: "user" | "system";
  governingAgentId?: string;
  blocks?: BlockDefinition[];
  edges?: EdgeDefinition[];
}

export interface UpdateWorkflowInput {
  name?: string;
  status?: WorkflowStatus;
  governingAgentId?: string | null;
  blocks?: BlockDefinition[];
  edges?: EdgeDefinition[];
}

// ── Workflow engine ──────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /**
   * When true, persist the run row + emit run_started, then return early
   * with status "running". The DAG walk continues in the background.
   * SSE consumers see live block events as they fire.
   *
   * Defaults to false — execute() awaits the full run and returns the
   * final WorkflowRunResult. Internal callers that need the result
   * (e.g., invoke-workflow) keep the sync behavior.
   */
  background?: boolean;
}

export interface WorkflowEngine {
  execute(workflowId: string, trigger?: TriggerPayload, opts?: ExecuteOptions): Promise<WorkflowRunResult>;
  /**
   * Resume a paused workflow run. Reloads the persisted execution state
   * (completed block outputs) from `workflow_block_runs`, marks the
   * paused block as completed with the supplied `userInput` as its output,
   * and continues the DAG walk from the paused block's outgoing edges.
   */
  resume(runId: string, userInput?: Record<string, unknown>): Promise<WorkflowRunResult>;
  cancel(runId: string): Promise<void>;
}

export interface TriggerPayload {
  type: string;
  data: Record<string, unknown>;
}

export interface WorkflowRunResult {
  runId: string;
  /**
   * `running` indicates the engine has persisted the run row and the DAG
   * walk is happening in the background — only returned from
   * execute(opts.background=true). All other statuses are terminal.
   */
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_for_human";
  blockResults: Map<string, BlockHandlerResult>;
  error?: string;
  /** When status=waiting_for_human, the task the user must act on to resume. */
  awaitingActionTaskId?: string;
}

// ── Workflow triggers ────────────────────────────────────────────────────────

export const TRIGGER_TYPES = ["cron", "webhook", "event"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export interface WorkflowTrigger {
  type: TriggerType;
  workflowId: string;
  config: Record<string, unknown>;
}

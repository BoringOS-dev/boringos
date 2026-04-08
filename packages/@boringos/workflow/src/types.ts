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
}

// ── Execution state ──────────────────────────────────────────────────────────

export interface ExecutionState {
  get(blockId: string): BlockState | undefined;
  set(blockId: string, state: BlockState): void;
  all(): Map<string, BlockState>;
}

export interface BlockState {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
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

export interface WorkflowEngine {
  execute(workflowId: string, trigger?: TriggerPayload): Promise<WorkflowRunResult>;
  cancel(runId: string): Promise<void>;
}

export interface TriggerPayload {
  type: string;
  data: Record<string, unknown>;
}

export interface WorkflowRunResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  blockResults: Map<string, BlockHandlerResult>;
  error?: string;
}

// ── Workflow triggers ────────────────────────────────────────────────────────

export const TRIGGER_TYPES = ["cron", "webhook", "event"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export interface WorkflowTrigger {
  type: TriggerType;
  workflowId: string;
  config: Record<string, unknown>;
}

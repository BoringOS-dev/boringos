// Shared types — mirror the engine's BlockDefinition / EdgeDefinition shape
// so the UI doesn't drift from the API contract.

export interface WorkflowBlock {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  sourceHandle: string | null;
  sortOrder: number;
}

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type WorkflowType = "user" | "system";

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  type: WorkflowType;
  status: WorkflowStatus;
  governingAgentId: string | null;
  blocks: WorkflowBlock[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunStatus = "queued" | "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type BlockRunStatus = "pending" | "running" | "completed" | "skipped" | "failed" | "waiting";

export interface WorkflowRun {
  id: string;
  tenantId: string;
  workflowId: string;
  triggerType: string;
  triggerPayload: Record<string, unknown> | null;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlockRun {
  id: string;
  workflowRunId: string;
  tenantId: string;
  blockId: string;
  blockName: string;
  blockType: string;
  status: BlockRunStatus;
  resolvedConfig: Record<string, unknown> | null;
  inputContext: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  selectedHandle: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

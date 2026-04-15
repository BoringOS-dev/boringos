// ── Base structural types ────────────────────────────────────────────────────

export interface Identifiable {
  id: string;
}

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantScoped {
  tenantId: string;
}

// ── Status and enum constants ────────────────────────────────────────────────

export const AGENT_STATUSES = ["idle", "running", "paused", "error", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ROUTINE_STATUSES = ["active", "paused", "archived"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export const WAKE_REASONS = [
  "comment_mentioned",
  "comment_posted",
  "routine_triggered",
  "manual_request",
  "approval_resolved",
  "connector_event",
] as const;
export type WakeReason = (typeof WAKE_REASONS)[number];

// ── Domain entity interfaces ─────────────────────────────────────────────────

export interface Agent extends Identifiable, TenantScoped, Timestamped {
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: AgentStatus;
  reportsTo: string | null;
  instructions: string | null;
  runtimeId: string | null;
  fallbackRuntimeId: string | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  pauseReason: string | null;
  pausedAt: Date | null;
  permissions: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  lastHeartbeatAt: Date | null;
}

export interface Task extends Identifiable, TenantScoped, Timestamped {
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  identifier: string | null;
  originKind: string;
  originId: string | null;
  requestDepth: number;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface TaskComment extends Identifiable, TenantScoped, Timestamped {
  taskId: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
}

export interface AgentRun extends Identifiable, TenantScoped, Timestamped {
  agentId: string;
  wakeupRequestId: string | null;
  status: RunStatus;
  exitCode: number | null;
  error: string | null;
  errorCode: string | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  model: string | null;
  usageJson: Record<string, unknown> | null;
  contextSnapshot: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface Approval extends Identifiable, TenantScoped, Timestamped {
  type: string;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
}

export interface Routine extends Identifiable, TenantScoped, Timestamped {
  title: string;
  description: string | null;
  assigneeAgentId: string;
  priority: TaskPriority;
  status: RoutineStatus;
  concurrencyPolicy: ConcurrencyPolicy;
  catchUpPolicy: CatchUpPolicy;
  lastTriggeredAt: Date | null;
}

export const CONCURRENCY_POLICIES = [
  "coalesce_if_active",
  "skip_if_active",
  "allow_concurrent",
] as const;
export type ConcurrencyPolicy = (typeof CONCURRENCY_POLICIES)[number];

export const CATCH_UP_POLICIES = ["skip_missed", "run_once", "run_all"] as const;
export type CatchUpPolicy = (typeof CATCH_UP_POLICIES)[number];

// ── SkillProvider — the Code + Knowledge contract ────────────────────────────

export interface SkillProvider {
  skillMarkdown(): string | null;
}

// ── Hook — typed event system ────────────────────────────────────────────────

export interface Hook<T> {
  use(handler: HookHandler<T>): void;
  remove(handler: HookHandler<T>): void;
  run(event: T): Promise<void>;
}

export type HookHandler<T> = (event: T) => void | Promise<void>;

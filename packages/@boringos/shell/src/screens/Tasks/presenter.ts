// SPDX-License-Identifier: BUSL-1.1
//
// Tasks screen — pure projection helpers.
//
// All filter / classification logic lives here so the React surfaces
// can be dumb. Tabs are intent-based, not status-based — see
// docs/blockers/done/task_05_tasks_rich_ux.md.

import type { Task } from "@boringos/ui";

export type TaskTab = "my-todos" | "watching" | "done" | "system" | "all";

export const TAB_ORDER: TaskTab[] = ["my-todos", "watching", "done", "system", "all"];

export const TAB_LABEL: Record<TaskTab, string> = {
  "my-todos": "My todos",
  watching: "Watching",
  done: "Done",
  system: "System",
  all: "All",
};

const SYSTEM_ORIGIN_KINDS = new Set([
  "inbox.item_created",
  "inbox.draft_reply",
  "routine",
]);

export function isSystemOrigin(kind: string): boolean {
  return SYSTEM_ORIGIN_KINDS.has(kind) || kind.startsWith("inbox.");
}

export function isCopilot(kind: string): boolean {
  return kind === "copilot";
}

export function isOpenStatus(status: string): boolean {
  return status !== "done" && status !== "cancelled";
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Project a task list onto a tab. The "needs attention" carve-out
 * (system tasks with failed runs surfacing in My todos) is layered
 * on top of this in Task D — at that point we'll pass an extra
 * `failedTaskIds` Set in.
 */
export function filterForTab(
  tasks: Task[],
  tab: TaskTab,
  meUserId: string,
  needsAttentionTaskIds: Set<string> = new Set(),
): Task[] {
  const now = Date.now();

  return tasks.filter((t) => {
    // Copilot tasks live on /copilot — always exclude from Tasks.
    if (isCopilot(t.originKind)) return false;

    const isMine =
      t.assigneeUserId === meUserId ||
      (t.assigneeUserId == null && t.createdByUserId === meUserId);
    const watchedByMe =
      t.createdByUserId === meUserId && t.assigneeAgentId != null;
    const sys = isSystemOrigin(t.originKind);
    const open = isOpenStatus(t.status);

    switch (tab) {
      case "my-todos":
        // Failed system tasks bubble up here regardless of origin.
        if (needsAttentionTaskIds.has(t.id)) return open;
        // Agent-action tasks always need a human decision — surface
        // them in My todos even when the agent didn't manage to set
        // assigneeUserId (defensive; the agent route should set it
        // from the parent's owner, but better safe).
        if (t.originKind === "agent_action" && open) return true;
        return isMine && open && !sys;
      case "watching":
        return watchedByMe && open;
      case "done": {
        if (t.status !== "done") return false;
        const completedAtMs = t.completedAt
          ? new Date(t.completedAt).getTime()
          : 0;
        // Done within last 30 days, mine or watched by me.
        const fresh = completedAtMs >= now - THIRTY_DAYS_MS;
        return fresh && (isMine || watchedByMe);
      }
      case "system":
        return sys;
      case "all":
        return true;
    }
  });
}

/** Cheap badge counts for the tab strip — runs on the same input. */
export function countsByTab(
  tasks: Task[],
  meUserId: string,
  needsAttentionTaskIds: Set<string> = new Set(),
): Record<TaskTab, number> {
  const result: Record<TaskTab, number> = {
    "my-todos": 0,
    watching: 0,
    done: 0,
    system: 0,
    all: 0,
  };
  for (const tab of TAB_ORDER) {
    result[tab] = filterForTab(tasks, tab, meUserId, needsAttentionTaskIds).length;
  }
  return result;
}

/** "5 minutes ago", "2 hours ago", "3 days ago", "Apr 7". */
export function formatRelativeTime(iso: string | Date | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = now.getTime() - t.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Origin label for the small badge in the row + detail header. */
export function originLabel(kind: string): string {
  switch (kind) {
    case "manual":
      return "Manual";
    case "human_todo":
      return "Question";
    case "agent_action":
      return "Action needed";
    case "handoff":
      return "Handoff";
    case "routine":
      return "Routine";
    case "inbox.item_created":
      return "From inbox";
    case "inbox.draft_reply":
      return "Draft reply";
    case "copilot":
      return "Copilot";
    default:
      return kind;
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// ── Approval decision helpers ───────────────────────────────────────

export interface ApprovalDecision {
  decision: "approve" | "reject";
  decidedAt: string;
  decidedByUserId: string | null;
  comment: string | null;
}

export function readApprovalDecision(task: Task): ApprovalDecision | null {
  const m = task.metadata;
  if (!m || typeof m !== "object") return null;
  const a = (m as { approval?: unknown }).approval;
  if (!a || typeof a !== "object") return null;
  const obj = a as Record<string, unknown>;
  if (obj.decision !== "approve" && obj.decision !== "reject") return null;
  if (typeof obj.decidedAt !== "string") return null;
  return {
    decision: obj.decision,
    decidedAt: obj.decidedAt,
    decidedByUserId:
      typeof obj.decidedByUserId === "string" ? obj.decidedByUserId : null,
    comment: typeof obj.comment === "string" ? obj.comment : null,
  };
}

export function readProposedParams(task: Task): Record<string, unknown> | null {
  return task.proposedParams ?? null;
}

/**
 * Friendly one-line summary of proposed params for the decision card
 * header — "send_email to mira@acme.com" / "spend $50 on credits".
 * Falls back to the action `kind` if the shape isn't recognized.
 */
export function summarizeProposedParams(p: Record<string, unknown> | null): string {
  if (!p) return "Action requested";
  const kind = typeof p.kind === "string" ? p.kind : null;
  if (!kind) return "Action requested";

  switch (kind) {
    case "send_email":
      return `Send email to ${p.to ?? "?"}`;
    case "modify_email":
      return `Modify Gmail labels on ${p.messageId ?? "message"}`;
    case "create_event":
      return `Create calendar event "${p.summary ?? "event"}"`;
    case "delete_event":
      return `Delete calendar event ${p.eventId ?? ""}`;
    case "spend":
      return `Spend ${p.currency ?? "$"}${p.amount ?? "?"} on ${p.purpose ?? "(unspecified)"}`;
    default:
      return kind.replace(/_/g, " ");
  }
}

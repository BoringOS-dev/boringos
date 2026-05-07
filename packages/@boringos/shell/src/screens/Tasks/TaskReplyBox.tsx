// SPDX-License-Identifier: BUSL-1.1
//
// Inline reply box on a task. Posting a comment auto-wakes the
// assigned agent (the framework's auto-wake-on-comment hook in
// admin-routes.ts already does this). Slash commands let the user
// drive the task while replying:
//
//   /done                 — mark task done after posting
//   /reopen               — flip status back to todo after posting
//   /assign @<agent name> — reassign to that agent and wake them
//
// Mentions:
//   @<agent name>         — auto-assign this comment's wake to that
//                           agent if no slash command set an explicit
//                           assignment. Surfaces as plain @-tag in
//                           the rendered markdown.

import { useMemo, useState } from "react";
import { useClient } from "@boringos/ui";
import type { Task, Agent } from "@boringos/ui";

export interface TaskReplyBoxProps {
  task: Task;
  agents: Agent[];
  onPosted: () => void;
}

interface ParsedCommand {
  /** Body to post as the comment, with slash directives stripped. */
  body: string;
  /** Final status to set (or leave alone if undefined). */
  setStatus?: "done" | "todo";
  /** Reassign to this agent id (resolved from @-mention) before waking. */
  assignAgentId?: string;
}

/** Match an agent name against a token (case-insensitive, allow `_` / spaces). */
function findAgentByMention(agents: Agent[], mention: string): Agent | null {
  const norm = mention.toLowerCase().replace(/[_\s-]+/g, "");
  for (const a of agents) {
    const name = (a.name ?? "").toLowerCase().replace(/[_\s-]+/g, "");
    if (name && name === norm) return a;
    if (name && name.startsWith(norm)) return a;
  }
  return null;
}

function parseCommand(raw: string, agents: Agent[]): ParsedCommand {
  let body = raw;
  let setStatus: "done" | "todo" | undefined;
  let assignAgentId: string | undefined;

  // /done at the start, end, or alone on a line.
  if (/(^|\n)\s*\/done\s*($|\n)/i.test(body)) {
    setStatus = "done";
    body = body.replace(/(^|\n)\s*\/done\s*($|\n)/gi, "$1$2").trim();
  }
  if (/(^|\n)\s*\/reopen\s*($|\n)/i.test(body)) {
    setStatus = "todo";
    body = body.replace(/(^|\n)\s*\/reopen\s*($|\n)/gi, "$1$2").trim();
  }

  // /assign @<name>
  const assignMatch = body.match(/(^|\n)\s*\/assign\s+@(\S+)\s*($|\n)/i);
  if (assignMatch) {
    const agent = findAgentByMention(agents, assignMatch[2]!);
    if (agent) {
      assignAgentId = agent.id;
    }
    body = body.replace(/(^|\n)\s*\/assign\s+@\S+\s*($|\n)/gi, "$1$2").trim();
  }

  return { body, setStatus, assignAgentId };
}

export function TaskReplyBox({ task, agents, onPosted }: TaskReplyBoxProps) {
  const client = useClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseCommand(body, agents), [body, agents]);
  const hasContent = parsed.body.trim().length > 0;
  const willChangeStatus = parsed.setStatus && parsed.setStatus !== task.status;
  const willReassign = parsed.assignAgentId && parsed.assignAgentId !== task.assigneeAgentId;

  const submit = async () => {
    if (!hasContent && !willChangeStatus && !willReassign) return;
    setError(null);
    setBusy(true);
    try {
      // 1) Reassign first so the wake-on-comment fires the right agent.
      if (parsed.assignAgentId) {
        await client.assignTask(task.id, parsed.assignAgentId, false);
      }
      // 2) Post the comment (auto-wakes the assignee on the server).
      if (hasContent) {
        await client.postComment(task.id, { body: parsed.body });
      }
      // 3) Status change last so the row reflects the latest state.
      if (parsed.setStatus && parsed.setStatus !== task.status) {
        await client.updateTask(task.id, { status: parsed.setStatus });
      }
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <section data-testid="task-reply-box">
      <div className="rounded-lg border border-slate-200 bg-white">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          rows={3}
          placeholder="Reply…  (markdown supported · /done · /assign @agent · ⌘+Enter to send)"
          className="w-full text-sm px-3 py-2.5 rounded-t-lg focus:outline-none resize-y font-sans"
        />
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-slate-100 bg-slate-50/50 rounded-b-lg">
          <div className="text-[11px] text-slate-500 flex items-center gap-2">
            {willReassign && (
              <span className="text-blue-700">
                ↻ Reassign to {agents.find((a) => a.id === parsed.assignAgentId)?.name}
              </span>
            )}
            {willChangeStatus && (
              <span className={parsed.setStatus === "done" ? "text-emerald-700" : "text-slate-700"}>
                ✓ Mark {parsed.setStatus}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-[11px] text-rose-600 max-w-[200px] truncate">{error}</span>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || (!hasContent && !willChangeStatus && !willReassign)}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {busy ? "Posting…" : "Reply"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

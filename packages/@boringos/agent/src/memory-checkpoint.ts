// task_24 F + task_25 gap fixes — auto-checkpoint hook.
//
// Every run finalisation (success or failure) appends a structured
// entry to the work's log file:
//
//   tasks/<taskId>/log.md                      — task-bound work
//   users/<ownerUserId>/sessions/<sid>.md      — copilot session
//
// Routing rule: a session log wins when we have both ownerUserId
// AND sessionId (copilot threads are user-context-rich, the
// session log is where the user expects to find the trace). All
// other task-bound wakes route to the task log.
//
// The hook **never** writes to MEMORY.md or decisions/ — promotion
// to durable surfaces is the agent's deliberate call, made on the
// NEXT wake when it reads the log and decides what's worth keeping.
//
// task_25 G1 — extracts the agent's final reply from agent_runs'
// stream-json output and embeds it in the log entry, so tomorrow's
// agent reading the log learns what was DECIDED, not just metadata.
//
// task_25 G2 — after writing the log, reindexes any new memory
// files the agent wrote via the workdir mount into `drive_files`,
// so `drive.search` and the UI can find them. Without this pass,
// agent-side filesystem writes (the path the SKILL now mandates)
// are invisible to anything that searches the index.
//
// Failures are best-effort: a Drive write error here must never
// mask the run's actual outcome. The engine has already returned
// the result to the caller by the time these hooks fire.

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agentRuns, driveFiles } from "@boringos/db";
import type { StorageBackend } from "@boringos/drive";
import {
  dailyDateStamp,
  dailyNoteHeader,
  isDailyNotePath,
  renderFragmentBlock,
} from "@boringos/brain";
import type { AfterRunEvent, RunErrorEvent } from "./types.js";

/**
 * Structural brain-indexer surface (docs/brain.md §4.4). The brain is
 * the ONE drive→Postgres path; injecting it here (rather than depending
 * on @boringos/brain from the agent package) keeps this package's deps
 * clean. The host wires the real `createIndexer(...)` result in.
 */
export interface BrainFileIndexer {
  indexMemoryFile(input: {
    tenantId: string;
    path: string;
    content: string;
    scope?: "tenant" | "user";
    ownerUserId?: string;
  }): Promise<unknown>;
}

export interface MemoryCheckpointDeps {
  drive: StorageBackend;
  /**
   * task_25 G1+G2 — db is now required. G1 reads
   * agent_runs.stdoutExcerpt to extract the agent's final assistant
   * reply for the log entry; G2 upserts driveFiles index rows after
   * scanning the memory tree.
   */
  db: Db;
  /**
   * Optional brain indexer (docs/brain.md §4.4). When wired, every
   * memory-tree markdown file the run touched is mirrored into the
   * brain (chunk + embed + FTS + graph) in the SAME pass that updates
   * the driveFiles index — the single, bounded drive→brain path that
   * covers native-FS writes and drive.write tool writes alike.
   * Replace-on-reindex (keyed on source_ref=path) makes re-indexing a
   * file the brain provider already wrote on remember() a no-op.
   */
  brainIndexer?: BrainFileIndexer;
}

export interface MemoryCheckpoint {
  onRunFinished(event: AfterRunEvent): Promise<void>;
  onRunFailed(event: RunErrorEvent): Promise<void>;
}

export function createMemoryCheckpoint(
  deps: MemoryCheckpointDeps,
): MemoryCheckpoint {
  const { drive, db, brainIndexer } = deps;

  async function appendEntry(
    tenantId: string,
    destPath: string,
    body: string,
  ): Promise<void> {
    try {
      const fullPath = `${tenantId}/${destPath}`;
      let existing = "";
      if (await drive.exists(fullPath)) {
        existing = await drive.readText(fullPath);
        if (existing.length > 0 && !existing.endsWith("\n")) existing += "\n";
      } else {
        existing = headerFor(destPath);
      }
      await drive.write(fullPath, existing + body);
    } catch {
      /* best-effort */
    }
  }

  function destinationFor(opts: {
    taskId?: string;
    ownerUserId?: string;
    sessionId?: string;
  }): string | null {
    if (opts.ownerUserId && opts.sessionId) {
      // Memory tree v2 (docs/brain.md §4.5): per-session checkpoint files
      // die — the session run appends to the owner's append-only daily
      // note instead, so "what happened" is one readable file, not N
      // session files. (Task-bound runs still keep their tasks/<id>/log.md
      // working log below.)
      return `users/${opts.ownerUserId}/memory/60-daily/${dailyDateStamp(new Date())}.md`;
    }
    if (opts.taskId) {
      return `tasks/${opts.taskId}/log.md`;
    }
    return null;
  }

  /**
   * task_25 G1 — fetch the run's final assistant message. Reads
   * agent_runs.stdoutExcerpt (already maintained by the run
   * lifecycle) and walks backwards through the stream-json output
   * for the `{ type: "result", result: "<text>" }` line that
   * carries the agent's final reply. Falls back to the raw
   * excerpt's tail when stream-json isn't parseable.
   */
  async function fetchReplyText(runId: string): Promise<string | null> {
    try {
      const rows = await db
        .select({ excerpt: agentRuns.stdoutExcerpt })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .limit(1);
      const excerpt = rows[0]?.excerpt;
      if (!excerpt) return null;

      const lines = excerpt.split("\n").filter((l) => l.length > 0);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed?.type === "result" && typeof parsed.result === "string") {
            return parsed.result.trim();
          }
        } catch {
          /* not JSON — keep walking */
        }
      }
      // Fall back to a tail-trimmed slice so something useful lands
      // in the log even when the runtime didn't emit stream-json
      // (the command runtime, for example, can return raw stdout).
      const tail = excerpt.slice(-2000).trim();
      return tail.length > 0 ? tail : null;
    } catch {
      return null;
    }
  }

  /**
   * task_25 G2 — after a run, reconcile memory files the agent
   * wrote via the workdir mount into the driveFiles index. Walks
   * the in-scope memory roots and upserts any file with mtime >=
   * the run's start time. Cheap because the memory tree is bounded
   * per scope; expensive only if an agent writes thousands of
   * files in one run, which the SKILL discourages.
   *
   * We use the Drive `stat()` mtime as the source of truth for
   * "what's new since the run started." The run's started_at is
   * available on agent_runs.
   */
  async function reindexMemoryWrites(opts: {
    tenantId: string;
    runId: string;
    ownerUserId?: string;
  }): Promise<void> {
    try {
      const runRows = await db
        .select({ startedAt: agentRuns.startedAt })
        .from(agentRuns)
        .where(eq(agentRuns.id, opts.runId))
        .limit(1);
      const startedAt = runRows[0]?.startedAt;
      if (!startedAt) return;
      const startMs = startedAt.getTime();

      // Scopes: the wake-owner's user memory (if applicable) +
      // tenant-shared memory. Both can receive agent writes.
      const roots: string[] = [`shared/memory`];
      if (opts.ownerUserId) roots.push(`users/${opts.ownerUserId}/memory`);

      for (const root of roots) {
        const tenantRoot = `${opts.tenantId}/${root}`;
        const files = await listAllFiles(drive, tenantRoot);
        for (const file of files) {
          // The Drive `list()` returns paths relative to the
          // backend's root. We strip the tenant prefix to get the
          // canonical drive-file path (`users/<id>/memory/...`).
          const relPath = file.path.startsWith(`${opts.tenantId}/`)
            ? file.path.slice(opts.tenantId.length + 1)
            : file.path;
          const stat = await drive.stat(file.path);
          if (!stat) continue;
          if (stat.modifiedAt.getTime() < startMs) continue;

          const filename = relPath.split("/").pop() ?? relPath;
          const ext = filename.includes(".")
            ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
            : "";
          // driveFiles has no unique constraint on (tenant_id, path),
          // so onConflictDoUpdate silently no-ops. Delete-then-insert
          // is the portable upsert here. Wrapped in try so a race
          // with a parallel writer is just a no-op.
          try {
            await db
              .delete(driveFiles)
              .where(
                and(
                  eq(driveFiles.tenantId, opts.tenantId),
                  eq(driveFiles.path, relPath),
                ),
              );
            await db.insert(driveFiles).values({
              tenantId: opts.tenantId,
              path: relPath,
              filename,
              format: ext,
              size: stat.size,
              hash: "",
              updatedAt: new Date(),
            });
          } catch {
            /* per-file failure is best-effort; reindex continues */
          }

          // Brain mirror (docs/brain.md §4.4): index markdown memory
          // files into Postgres so brain.search / brain.graph see what
          // the agent wrote natively this run. Scope is derived from
          // the path: users/<owner>/... is user-scope, everything else
          // tenant-scope. Best-effort — never masks the run outcome.
          if (brainIndexer && ext === "md") {
            try {
              const content = await drive.readText(file.path);
              const isUser = relPath.startsWith("users/");
              const ownerUserId = isUser ? relPath.split("/")[1] : undefined;
              // indexMemoryFile fragment-indexes daily notes (§4.5) and
              // whole-file-indexes everything else.
              await brainIndexer.indexMemoryFile({
                tenantId: opts.tenantId,
                path: relPath,
                content,
                scope: isUser ? "user" : "tenant",
                ownerUserId,
              });
            } catch {
              /* brain indexing is best-effort */
            }
          }
        }
      }
    } catch {
      /* reindex is best-effort */
    }
  }

  return {
    async onRunFinished(event: AfterRunEvent): Promise<void> {
      const dest = destinationFor({
        taskId: event.taskId,
        ownerUserId: event.ownerUserId,
        sessionId: event.sessionId,
      });
      if (!dest) {
        // No log destination, but reindex still runs for tenant-
        // shared memory writes from routine wakes.
        await reindexMemoryWrites({
          tenantId: event.tenantId,
          runId: event.runId,
          ownerUserId: event.ownerUserId,
        });
        return;
      }

      const replyText = await fetchReplyText(event.runId);
      const outcome = event.result.exitCode === 0 ? "success" : "failed";

      // Body priority: agent's actual reply > runtime errorMessage
      // > placeholder. Bound the embed at ~4 kB so a chatty run
      // doesn't bloat the log file. Truncation is grep-friendly:
      // the heading + first 4 kB still parses fine.
      const MAX_REPLY_BYTES = 4000;
      let body: string;
      if (replyText) {
        body =
          replyText.length > MAX_REPLY_BYTES
            ? replyText.slice(0, MAX_REPLY_BYTES) + "\n\n…(truncated)"
            : replyText;
      } else if (event.result.errorMessage) {
        body = event.result.errorMessage;
      } else if (event.result.exitCode === 0) {
        body = "Run completed.";
      } else {
        body = `Exit code ${event.result.exitCode}.`;
      }

      const entry = isDailyNotePath(dest)
        ? renderDailyRunFragment({
            timestamp: new Date(),
            runId: event.runId,
            agentId: event.agentId,
            outcome,
            body,
            taskId: event.taskId,
          })
        : renderEntry({
            timestamp: new Date(),
            runId: event.runId,
            agentId: event.agentId,
            outcome,
            body,
          });
      await appendEntry(event.tenantId, dest, entry);

      // Reindex AFTER the log write so the new log file itself
      // shows up in the index too. Cheap; we already have the
      // tree walk infra.
      await reindexMemoryWrites({
        tenantId: event.tenantId,
        runId: event.runId,
        ownerUserId: event.ownerUserId,
      });
    },

    async onRunFailed(event: RunErrorEvent): Promise<void> {
      const dest = destinationFor({
        taskId: event.taskId,
        ownerUserId: event.ownerUserId,
        sessionId: event.sessionId,
      });
      if (!dest) return;

      // On failure, still try to surface what the agent said
      // before things went sideways — that's often the most
      // diagnostic line in the log.
      const replyText = await fetchReplyText(event.runId);
      const body = replyText
        ? `${event.error.message}\n\n— last agent message —\n${replyText.slice(0, 2000)}`
        : event.error.message;

      const entry = isDailyNotePath(dest)
        ? renderDailyRunFragment({
            timestamp: new Date(),
            runId: event.runId,
            agentId: event.agentId,
            outcome: "error",
            body,
            taskId: event.taskId,
          })
        : renderEntry({
            timestamp: new Date(),
            runId: event.runId,
            agentId: event.agentId,
            outcome: "error",
            body,
          });
      await appendEntry(event.tenantId, dest, entry);
    },
  };
}

/**
 * Recursive walker over the StorageBackend. The backend's `list`
 * is single-level; we recurse into directory entries. Bounded by
 * a hard cap so a runaway tree doesn't melt the reindex.
 */
async function listAllFiles(
  drive: StorageBackend,
  prefix: string,
): Promise<Array<{ path: string }>> {
  const out: Array<{ path: string }> = [];
  const HARD_CAP = 2000;
  await walk(drive, prefix, out, HARD_CAP);
  return out;
}

async function walk(
  drive: StorageBackend,
  prefix: string,
  out: Array<{ path: string }>,
  capRemaining: number,
): Promise<number> {
  let remaining = capRemaining;
  if (remaining <= 0) return 0;
  let entries: Array<{ path: string; isDirectory: boolean }>;
  try {
    entries = await drive.list(prefix);
  } catch {
    return remaining;
  }
  for (const entry of entries) {
    if (remaining <= 0) break;
    if (entry.isDirectory) {
      remaining = await walk(drive, entry.path, out, remaining);
    } else {
      out.push({ path: entry.path });
      remaining -= 1;
    }
  }
  return remaining;
}

function renderEntry(fields: {
  timestamp: Date;
  runId: string;
  agentId: string;
  outcome: "success" | "failed" | "error";
  body: string;
}): string {
  const ts = fields.timestamp.toISOString();
  return [
    "",
    `## ${ts} — run ${fields.runId} — ${fields.outcome}`,
    `agent: ${fields.agentId}`,
    "",
    fields.body.trim(),
    "",
  ].join("\n");
}

/**
 * Render a run checkpoint as a v2 daily-note fragment (docs/brain.md
 * §4.5). The invisible `<!-- frag run … -->` marker lets the brain
 * index this run as its own row (`<dailyPath>#<runId>`) and the curator
 * promote/archive it, while the `## HH:MM run <id8>` header keeps the
 * file grep-friendly.
 */
function renderDailyRunFragment(fields: {
  timestamp: Date;
  runId: string;
  agentId: string;
  outcome: "success" | "failed" | "error";
  body: string;
  taskId?: string;
}): string {
  const iso = fields.timestamp.toISOString();
  const hhmm = iso.slice(11, 16);
  const id8 = fields.runId.slice(0, 8);
  const ctx = fields.taskId ? `task ${fields.taskId.slice(0, 8)}` : "session";
  return renderFragmentBlock({
    kind: "run",
    subid: fields.runId,
    ts: iso,
    header: `## ${hhmm} run ${id8} (${ctx})`,
    body: `agent: ${fields.agentId} — ${fields.outcome}\n\n${fields.body.trim()}`,
  });
}

function headerFor(destPath: string): string {
  if (isDailyNotePath(destPath)) {
    return dailyNoteHeader(destPath.split("/").pop()?.replace(/\.md$/, "") ?? "");
  }
  if (destPath.startsWith("users/")) {
    return (
      "# Session log\n\n" +
      "Append-only trace of agent runs in this copilot session. Each entry\n" +
      "is a level-2 heading you can grep for: timestamp, run id, outcome.\n\n" +
      "The body of each entry is the agent's final reply on that run —\n" +
      "what it actually said before handing back to you.\n\n"
    );
  }
  return (
    "# Task log\n\n" +
    "Append-only trace of agent runs on this task. Each entry is a level-2\n" +
    "heading you can grep for: timestamp, run id, outcome.\n\n" +
    "The body of each entry is the agent's final reply on that run —\n" +
    "what it actually said before handing back to you.\n\n"
  );
}

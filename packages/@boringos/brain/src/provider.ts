// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The pgvector MemoryProvider (docs/brain.md §7, decision #5). This
// REPLACES the external Hebbs provider as the framework default.
//
// Files stay the system of record (decision #3): remember() still
// writes a human-readable markdown file under the tenant's Drive
// memory tree — the exact bytes the agent reads through its workdir
// mount. The brain difference is that every write is ALSO chunked,
// embedded (when the semantic tier is live), FTS-indexed, and graph-
// wired into Postgres, so recall is hybrid retrieval instead of regex
// grep, and the typed graph fills itself with zero LLM calls.
//
// prime() returns null ON PURPOSE (decision #10): agents read their own
// memory tree natively (MEMORY.md + grep on the mount). The brain's
// job is the part no CLI has — hybrid retrieval at corpus scale via
// recall() / brain.search, not re-summarising the tree into the prompt.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type {
  MemoryProvider,
  MemoryMeta,
  RecallOptions,
  RecallResult,
} from "@boringos/memory";
import { resolveEmbedder } from "./embedder.js";
import { probeCapabilities } from "./capability.js";
import { createIndexer, type BrainIndexer } from "./indexer.js";
import { searchHybrid, reinforce } from "./retrieval.js";
import {
  dailyDateStamp,
  renderFragmentBlock,
  stripFragment,
  dailyNoteHeader,
} from "./daily.js";
import type { Embedder } from "./types.js";

// Serialize append-read-modify-write per daily-note path so two
// remember() calls in the same process can't clobber each other's
// append. Cross-process appends (the checkpoint hook) are reconciled
// idempotently by the post-run reindex's fragment GC.
const dailyLocks = new Map<string, Promise<unknown>>();
function withDailyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = dailyLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  dailyLocks.set(
    key,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

/** Structural Drive backend — avoids a hard dep on @boringos/drive. */
export interface DriveLike {
  write(path: string, content: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** Single-level listing; the curator walks the tree recursively. */
  list(prefix?: string): Promise<Array<{ path: string; name: string; isDirectory: boolean }>>;
}

export interface BrainMemoryConfig {
  drive: DriveLike;
  db: Db;
  /** Defaults to resolveEmbedder() from the environment. */
  embedder?: Embedder;
}

const BRAIN_MEMORY_SKILL = `Memory is a Postgres-backed brain over your Drive memory tree. The
files under \`./drive/users/<owner>/memory/\` and \`./drive/shared/memory/\`
are the system of record — read them the Claude Code way (open
\`MEMORY.md\`, navigate, \`grep\`). Every write is also indexed into the
brain, so \`memory.recall\` / \`brain.search\` give you hybrid semantic +
keyword retrieval, and \`[[wikilinks]]\` auto-wire a typed entity graph.

Layout (numbered = read priority):
  MEMORY.md      index + pointers, <200 lines
  10-domains/    canonical facts (each ends with "(src: …)")
  20-decisions/  dated, who + why
  30-people/ 40-operations/
  60-daily/YYYY-MM-DD.md   append-only landing zone
  70-weekly/  99-archive/

Read order on wake: preferences → your MEMORY.md → shared MEMORY.md →
today's + yesterday's 60-daily → current 70-weekly → grep on demand.

Write order:
- A quick fact / ambient observation → \`memory.remember\` (lands in
  today's 60-daily note; promoted to a durable folder at synthesis).
- A standing rule / explicit "remember / from now on / always" → write
  it straight into \`20-decisions/<topic>.md\` (Bash/Write) + a one-line
  MEMORY.md pointer, before responding.
- Stable facts about an entity → \`10-domains/<entity>.md\`, with
  [[wikilinks]] so the graph wires up.
One canonical home per fact; MEMORY.md holds pointers, not warehouses.`;

export function createBrainMemory(config: BrainMemoryConfig): MemoryProvider {
  const { drive, db } = config;
  const embedder = config.embedder ?? resolveEmbedder();

  // Indexer + capabilities are resolved lazily on first use so the
  // provider can be constructed before the capability probe runs
  // (no async work in the factory).
  let indexerPromise: Promise<BrainIndexer> | null = null;
  async function getIndexer(): Promise<BrainIndexer> {
    if (!indexerPromise) {
      indexerPromise = (async () => {
        const caps = await probeCapabilities(db);
        return createIndexer({ db, embedder, hasVector: caps.hasVector });
      })();
    }
    return indexerPromise;
  }

  return {
    name: "brain",

    skillMarkdown(): string {
      return BRAIN_MEMORY_SKILL;
    },

    async remember(content: string, meta?: MemoryMeta): Promise<string> {
      const tenantId = meta?.tenantId;
      if (!tenantId) {
        throw new Error("brain-memory: remember() requires meta.tenantId");
      }
      const scope = resolveScope(meta);
      const scopeRoot = scopeRootFor(scope, meta?.ownerUserId);
      if (!scopeRoot) {
        throw new Error('brain-memory: scope "user" requires meta.ownerUserId');
      }

      // Memory tree v2 (docs/brain.md §4.5): a remembered fact APPENDS a
      // fragment to today's append-only daily note instead of spawning a
      // timestamped fragment file. The fragment is delimited by an
      // invisible marker so it stays human-readable yet individually
      // indexable + forgettable. The memory id is `<dailyPath>#<subid>`.
      const now = new Date();
      const iso = now.toISOString();
      const hhmm = iso.slice(11, 16);
      const date = dailyDateStamp(now);
      // subid is unique per append (content may repeat within a day).
      const subid = createHash("sha256").update(`${content}\n${iso}`).digest("hex").slice(0, 8);
      const dailyRelPath = `${scopeRoot}/memory/60-daily/${date}.md`;
      const tenantPath = `${tenantId}/${dailyRelPath}`;
      const sourceRef = `${dailyRelPath}#${subid}`;

      const tags = meta?.tags?.length ? ` · ${meta.tags.join(", ")}` : "";
      const block = renderFragmentBlock({
        kind: "mem",
        subid,
        ts: iso,
        header: `### ${hhmm}${tags}`,
        body: content,
      });

      // Append under a per-path lock (read-modify-write).
      await withDailyLock(tenantPath, async () => {
        const existing = (await drive.exists(tenantPath))
          ? await drive.readText(tenantPath)
          : dailyNoteHeader(date);
        const base = existing.endsWith("\n") ? existing : `${existing}\n`;
        await drive.write(tenantPath, base + block + "\n");
      });

      // Mirror just this fragment into Postgres (chunk + embed + FTS +
      // graph). Keyed on the fragment source_ref so the post-run reindex
      // reconciles idempotently and forget() can strike exactly this one.
      const indexer = await getIndexer();
      await indexer.index({
        tenantId,
        sourceKind: "manual",
        sourceRef,
        content,
        importance: meta?.importance,
        entityId: meta?.entityId,
        scope,
        ownerUserId: meta?.ownerUserId,
      });

      return sourceRef;
    },

    async recall(query: string, options?: RecallOptions): Promise<RecallResult[]> {
      const tenantId = options?.tenantId;
      if (!tenantId) {
        throw new Error("brain-memory: recall() requires options.tenantId");
      }
      const caps = await probeCapabilities(db);
      const hits = await searchHybrid(db, embedder, caps.hasVector, {
        tenantId,
        query,
        scope: options?.scope,
        ownerUserId: options?.ownerUserId,
        entityId: options?.entityId,
        limit: options?.limit ?? 20,
      });

      // Reinforcement signal (§4.2) — best-effort.
      void reinforce(db, hits.map((h) => h.id));

      const minScore = options?.minScore ?? 0;
      return hits
        .filter((h) => h.score >= minScore)
        .map((h) => ({
          id: h.sourceRef ?? h.id,
          content: h.content,
          score: h.score,
          meta: { tenantId, scope: h.scope as "user" | "tenant" },
          createdAt: h.createdAt ?? undefined,
        }));
    },

    async prime(): Promise<string | null> {
      // Deliberately null — see header. Agents read their own tree;
      // recall()/brain.search are the active retrieval surfaces.
      return null;
    },

    async forget(memoryId: string): Promise<void> {
      // memoryId arrives as the full backend path `<tenantId>/<rel>`
      // (the memory.forget tool composes it). Two shapes:
      //   v2 fragment: `<tenantId>/<dailyPath>#<subid>` — strike just
      //                that block from the daily note + soft-delete its
      //                mirror rows/edges (the day's other facts survive).
      //   legacy file: `<tenantId>/<path>` — delete the file + soft-delete.
      const slash = memoryId.indexOf("/");
      const tenantId = slash > 0 ? memoryId.slice(0, slash) : "";
      const rel = slash > 0 ? memoryId.slice(slash + 1) : memoryId;
      const tenantLooksReal = /^[0-9a-f-]{36}$/i.test(tenantId) || /^[\w-]+$/.test(tenantId);
      const indexer = await getIndexer();

      const hashIdx = rel.indexOf("#");
      if (hashIdx > 0) {
        // Fragment forget.
        const dailyRelPath = rel.slice(0, hashIdx);
        const subid = rel.slice(hashIdx + 1);
        const tenantPath = `${tenantId}/${dailyRelPath}`;
        await withDailyLock(tenantPath, async () => {
          try {
            if (await drive.exists(tenantPath)) {
              const next = stripFragment(await drive.readText(tenantPath), subid);
              if (next !== null) await drive.write(tenantPath, next);
            }
          } catch {
            /* file strike is best-effort; the mirror soft-delete is authoritative */
          }
        });
        if (tenantLooksReal) {
          await indexer.softDeleteBySource(tenantId, `${dailyRelPath}#${subid}`).catch(() => {});
        }
        return;
      }

      // Legacy whole-file forget.
      await drive.delete(memoryId).catch(() => {});
      if (tenantLooksReal && slash > 0) {
        await indexer.softDeleteBySource(tenantId, rel).catch(() => {});
      }
    },

    async ping(): Promise<boolean> {
      try {
        await db.execute(sql`SELECT 1`);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ── helpers (mirror the drive-memory provider's routing) ─────────────

function resolveScope(meta?: MemoryMeta): "user" | "tenant" {
  if (meta?.scope) return meta.scope;
  return meta?.ownerUserId ? "user" : "tenant";
}

function scopeRootFor(scope: "user" | "tenant", ownerUserId?: string): string | null {
  if (scope === "tenant") return "shared";
  if (!ownerUserId) return null;
  return `users/${ownerUserId}`;
}

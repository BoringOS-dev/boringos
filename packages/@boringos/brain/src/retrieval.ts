// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hybrid retrieval (docs/brain.md §4.2). NOT vector-alone:
//
//   vector cosine  +  BM25/FTS  +  reciprocal-rank fusion  +  recency/
//   importance bump
//
// One SQL-driven path. When pgvector is absent (the embedded-Postgres
// FTS floor, decision #2) the vector arm is skipped and we answer from
// FTS alone — same function, fewer signals. RRF makes the blend robust
// to either arm returning nothing.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { Embedder } from "./types.js";
import type { BrainHit } from "./types.js";
import { toVectorLiteral } from "./embedder.js";

/** Reciprocal-rank-fusion constant. 60 is the value from the original RRF paper. */
const RRF_K = 60;

export interface SearchOptions {
  tenantId: string;
  query: string;
  limit?: number;
  /** How many candidates each arm pulls before fusion. */
  candidates?: number;
  scope?: "tenant" | "user";
  ownerUserId?: string;
  /** Restrict to a subject (agent/contact/deal). */
  entityId?: string;
}

interface RawRow {
  id: string;
  content: string;
  source_kind: string;
  source_ref: string | null;
  chunk_index: number;
  importance: number;
  scope: string;
  created_at: Date | null;
  fts_score?: number;
  vec_score?: number;
}

function scopeClause(opts: SearchOptions) {
  if (opts.scope === "tenant") return sql`AND scope = 'tenant'`;
  if (opts.scope === "user") {
    return opts.ownerUserId
      ? sql`AND scope = 'user' AND owner_user_id = ${opts.ownerUserId}`
      : sql`AND false`; // can't address user scope without an owner
  }
  // Unset: tenant rows always; user rows only for the given owner.
  return opts.ownerUserId
    ? sql`AND (scope = 'tenant' OR (scope = 'user' AND owner_user_id = ${opts.ownerUserId}))`
    : sql`AND scope = 'tenant'`;
}

/**
 * Run hybrid retrieval. `embedder` is consulted only when `hasVector`
 * is true AND the embedder has a model (the floor's nullEmbedder has
 * `model: null`).
 */
export async function searchHybrid(
  db: Db,
  embedder: Embedder,
  hasVector: boolean,
  opts: SearchOptions,
): Promise<BrainHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const candidates = Math.min(Math.max(opts.candidates ?? limit * 4, limit), 200);
  const entityFilter = opts.entityId ? sql`AND entity_id = ${opts.entityId}` : sql``;
  const scope = scopeClause(opts);

  // ── FTS arm ────────────────────────────────────────────────────
  const ftsRows = (await db.execute(sql`
    SELECT id::text AS id, content, source_kind, source_ref, chunk_index,
           importance, scope, created_at,
           ts_rank_cd(fts, websearch_to_tsquery('english', ${opts.query})) AS fts_score
    FROM brain__memories
    WHERE tenant_id = ${opts.tenantId}::uuid
      AND deleted_at IS NULL
      AND fts @@ websearch_to_tsquery('english', ${opts.query})
      ${scope} ${entityFilter}
    ORDER BY fts_score DESC
    LIMIT ${candidates}
  `)) as unknown as RawRow[];

  // ── Vector arm (only when the tier is live) ──────────────────────
  let vecRows: RawRow[] = [];
  const useVector = hasVector && embedder.model !== null;
  if (useVector) {
    try {
      const [qvec] = await embedder.embed([opts.query]);
      if (qvec && qvec.length > 0) {
        const lit = toVectorLiteral(qvec);
        vecRows = (await db.execute(sql`
          SELECT id::text AS id, content, source_kind, source_ref, chunk_index,
                 importance, scope, created_at,
                 1 - (embedding <=> ${lit}::vector) AS vec_score
          FROM brain__memories
          WHERE tenant_id = ${opts.tenantId}::uuid
            AND deleted_at IS NULL
            AND embedding IS NOT NULL
            ${scope} ${entityFilter}
          ORDER BY embedding <=> ${lit}::vector
          LIMIT ${candidates}
        `)) as unknown as RawRow[];
      }
    } catch (err) {
      // A live-embedding failure (network, quota) must not break
      // recall — degrade to whatever FTS already found.
      console.warn(
        "[brain] vector arm failed, falling back to FTS-only for this query:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Reciprocal-rank fusion ───────────────────────────────────────
  const byId = new Map<string, { row: RawRow; score: number; matched: BrainHit["matched"] }>();

  ftsRows.forEach((row, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    byId.set(row.id, {
      row,
      score: rrf,
      matched: { fts: row.fts_score ?? 0 },
    });
  });

  vecRows.forEach((row, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = byId.get(row.id);
    if (existing) {
      existing.score += rrf;
      existing.matched.vector = row.vec_score ?? 0;
    } else {
      byId.set(row.id, {
        row,
        score: rrf,
        matched: { vector: row.vec_score ?? 0 },
      });
    }
  });

  // Recency + importance bump: tiny additive nudge so that, all else
  // equal, fresher and more-important memories win. Kept small so it
  // can't override a genuine relevance gap.
  const now = Date.now();
  const fused = [...byId.values()].map((e) => {
    const ageDays = e.row.created_at
      ? (now - new Date(e.row.created_at).getTime()) / 86_400_000
      : 365;
    const recency = Math.max(0, 0.01 * (1 - Math.min(ageDays, 365) / 365));
    const importanceBump = 0.01 * (e.row.importance ?? 0.5);
    return { ...e, score: e.score + recency + importanceBump };
  });

  fused.sort((a, b) => b.score - a.score);

  return fused.slice(0, limit).map((e) => ({
    id: e.row.id,
    content: e.row.content,
    sourceKind: e.row.source_kind,
    sourceRef: e.row.source_ref,
    chunkIndex: e.row.chunk_index,
    importance: e.row.importance,
    score: e.score,
    matched: e.matched,
    scope: e.row.scope,
    createdAt: e.row.created_at ? new Date(e.row.created_at) : null,
  }));
}

/**
 * Reinforcement signal (§4.2): bump access_count on the rows a recall
 * actually returned. One of the two writers of access_count (the other
 * is distillation dedup). Best-effort — never blocks the read.
 */
export async function reinforce(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await db.execute(sql`
      UPDATE brain__memories
      SET access_count = access_count + 1, updated_at = now()
      WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
  } catch {
    /* reinforcement is best-effort */
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The indexer (docs/brain.md §4.2, §4.4) — the ONE drive→Postgres
// path. Turns a source (a memory file, a manual fact, a row pointer)
// into chunked brain__memories rows + auto-wired graph edges.
//
// Replace-on-reindex: every index call soft-deletes the source's
// prior rows + edges first, then inserts fresh ones, keyed on
// source_ref. Re-indexing a file never accretes duplicates; deleting
// it soft-deletes the mirror (version history preserved).
//
// Row pointers (decision #11): when the source already lives in an
// operational table, we index ONLY a representative snippet with
// source_kind='row' and source_ref='<table>:<id>' — never a verbatim
// copy. brain.ask joins back to the live row for authoritative content.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { chunkContent } from "./chunk.js";
import { createGraphWriter, type GraphWriter } from "./graph.js";
import { toVectorLiteral } from "./embedder.js";
import { isDailyNotePath, parseDailyFragments } from "./daily.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { Embedder, IndexInput } from "./types.js";

export interface BrainIndexer {
  /** Index any content. Returns the inserted memory row ids. */
  index(input: IndexInput): Promise<string[]>;
  /** Convenience for the drive→brain file path. */
  indexFile(input: {
    tenantId: string;
    path: string;
    content: string;
    scope?: "tenant" | "user";
    ownerUserId?: string;
  }): Promise<string[]>;
  /**
   * Index a memory-tree file (docs/brain.md §4.5). Daily notes
   * (`…/60-daily/*.md`) are indexed PER FRAGMENT — each remembered fact
   * / run checkpoint becomes its own row keyed `<path>#<subid>`, and
   * fragments that have disappeared from the file are garbage-collected.
   * Every other memory file is indexed whole (chunked), like indexFile.
   * This is the single path the drive→brain mirror should call.
   */
  indexMemoryFile(input: {
    tenantId: string;
    path: string;
    content: string;
    scope?: "tenant" | "user";
    ownerUserId?: string;
  }): Promise<string[]>;
  /** Index a pointer to a live operational row (decision #11). */
  indexRowPointer(input: {
    tenantId: string;
    table: string;
    rowId: string;
    snippet: string;
    entityId?: string;
  }): Promise<string[]>;
  /** Soft-delete a source's mirror rows + edges (file/memory delete). */
  softDeleteBySource(tenantId: string, sourceRef: string): Promise<void>;
  /** The graph writer, exposed for callers that register module entities. */
  graph: GraphWriter;
}

export function createIndexer(deps: {
  db: Db;
  embedder: Embedder;
  hasVector: boolean;
}): BrainIndexer {
  const { db, embedder, hasVector } = deps;
  const graph = createGraphWriter(db);
  const useVector = hasVector && embedder.model !== null;

  async function softDeleteBySource(tenantId: string, sourceRef: string): Promise<void> {
    await db.execute(sql`
      UPDATE brain__memories SET deleted_at = now(), updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND source_ref = ${sourceRef} AND deleted_at IS NULL
    `);
    await graph.softDeleteBySource(tenantId, sourceRef);
  }

  /**
   * Soft-delete any fragment rows for a daily note whose `<path>#<subid>`
   * source_ref is no longer present in the file. `presentRefs` is the set
   * of fragments the current file holds; everything else under
   * `<dailyPath>#…` is stale (a forgotten fact or a hand-deleted block).
   */
  async function gcRemovedFragments(
    tenantId: string,
    dailyPath: string,
    presentRefs: string[],
  ): Promise<void> {
    const prefix = `${dailyPath}#`;
    const live = (await db.execute(sql`
      SELECT DISTINCT source_ref FROM brain__memories
      WHERE tenant_id = ${tenantId}::uuid
        AND starts_with(source_ref, ${prefix})
        AND deleted_at IS NULL
    `)) as unknown as Array<{ source_ref: string }>;
    const present = new Set(presentRefs);
    for (const row of live) {
      if (!present.has(row.source_ref)) {
        await softDeleteBySource(tenantId, row.source_ref);
      }
    }
  }

  async function index(input: IndexInput): Promise<string[]> {
    const content = input.content?.trim() ?? "";
    if (content.length === 0) {
      // Empty content = the source was cleared; treat as a delete.
      await softDeleteBySource(input.tenantId, input.sourceRef);
      return [];
    }

    // 1. Chunk first (row pointers + short facts index as one row).
    const chunks = input.noChunk
      ? [{ index: 0, content }]
      : chunkContent(content);
    if (chunks.length === 0) return [];

    // 2. Idempotency short-circuit. If the live rows for this source_ref
    //    already hold exactly these chunks, the source is unchanged —
    //    skip the re-embed + re-insert entirely. This is what stops a
    //    file the brain provider's remember() just indexed (sourceKind
    //    'manual') from being re-embedded by the post-run reindex hook
    //    (sourceKind 'file'), and makes re-indexing an unchanged file
    //    across runs free. Chunking is deterministic, so equal content
    //    ⇒ equal chunks.
    const existing = (await db.execute(sql`
      SELECT id::text AS id, content FROM brain__memories
      WHERE tenant_id = ${input.tenantId}::uuid AND source_ref = ${input.sourceRef}
        AND deleted_at IS NULL
      ORDER BY chunk_index ASC
    `)) as unknown as Array<{ id: string; content: string }>;
    if (
      existing.length === chunks.length &&
      existing.every((row, i) => row.content === chunks[i].content)
    ) {
      return existing.map((r) => r.id);
    }

    // 3. Replace-on-reindex (content changed or new source).
    await softDeleteBySource(input.tenantId, input.sourceRef);

    // 4. Embed (best-effort — a failure degrades this source to the
    //    FTS floor for now; the lazy re-embed job picks it up later).
    let vectors: number[][] = [];
    if (useVector) {
      try {
        vectors = await embedder.embed(chunks.map((c) => c.content));
      } catch (err) {
        console.warn(
          "[brain-indexer] embedding failed, indexing FTS-only for this source:",
          err instanceof Error ? err.message : err,
        );
        vectors = [];
      }
    }

    // 5. Insert one row per chunk.
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec = vectors[i];
      const embedModel = vec ? embedder.model : null;

      const rows = vec
        ? ((await db.execute(sql`
            INSERT INTO brain__memories
              (tenant_id, entity_id, source_kind, source_ref, chunk_index, kind,
               content, embed_model, embedding, importance, scope, owner_user_id)
            VALUES
              (${input.tenantId}::uuid, ${input.entityId ?? null}, ${input.sourceKind},
               ${input.sourceRef}, ${chunk.index}, ${input.kind ?? "note"},
               ${chunk.content}, ${embedModel}, ${toVectorLiteral(vec)}::vector,
               ${input.importance ?? 0.5}, ${input.scope ?? "tenant"}, ${input.ownerUserId ?? null})
            RETURNING id::text AS id
          `)) as unknown as Array<{ id: string }>)
        : ((await db.execute(sql`
            INSERT INTO brain__memories
              (tenant_id, entity_id, source_kind, source_ref, chunk_index, kind,
               content, embed_model, importance, scope, owner_user_id)
            VALUES
              (${input.tenantId}::uuid, ${input.entityId ?? null}, ${input.sourceKind},
               ${input.sourceRef}, ${chunk.index}, ${input.kind ?? "note"},
               ${chunk.content}, ${null}, ${input.importance ?? 0.5},
               ${input.scope ?? "tenant"}, ${input.ownerUserId ?? null})
            RETURNING id::text AS id
          `)) as unknown as Array<{ id: string }>);
      if (rows[0]?.id) ids.push(rows[0].id);
    }

    // 6. Auto-wire graph edges from the full content (one pass, not
    //    per-chunk — wikilinks/mentions are document-level facts).
    //    Row pointers don't carry prose to mine, so skip them.
    if (input.sourceKind !== "row") {
      await graph.wireSource({
        tenantId: input.tenantId,
        sourceRef: input.sourceRef,
        content,
      });
    }

    return ids;
  }

  return {
    index,
    softDeleteBySource,
    graph,

    indexFile(input) {
      return index({
        tenantId: input.tenantId,
        sourceKind: "file",
        sourceRef: input.path,
        content: input.content,
        scope: input.scope,
        ownerUserId: input.ownerUserId,
      });
    },

    async indexMemoryFile(input) {
      // Non-daily memory files index whole (chunked). OKF frontmatter is
      // parsed: `type` → the row's kind, `resource` → a `describes` edge,
      // and the YAML block is stripped so it isn't embedded as content.
      if (!isDailyNotePath(input.path)) {
        const { fm, body } = parseFrontmatter(input.content);
        const ids = await index({
          tenantId: input.tenantId,
          sourceKind: "file",
          sourceRef: input.path,
          content: body,
          kind: typeof fm.type === "string" ? fm.type : undefined,
          scope: input.scope,
          ownerUserId: input.ownerUserId,
        });
        if (typeof fm.resource === "string" && fm.resource.trim()) {
          await graph.upsertEdge({
            tenantId: input.tenantId,
            srcType: "source",
            srcId: input.path,
            edgeType: "describes",
            dstType: "resource",
            dstId: fm.resource.trim(),
            weight: 1.0,
            sourceRef: input.path,
          });
        }
        return ids;
      }

      // Daily note: one row per fragment, keyed `<path>#<subid>`.
      const fragments = parseDailyFragments(input.content);
      const presentRefs: string[] = [];
      const ids: string[] = [];
      for (const f of fragments) {
        if (!f.body) continue;
        // Promoted fragments live in a durable folder now (§4.5) — leave
        // them as raw history in the file but keep them OUT of the daily
        // mirror tier. Not adding to presentRefs lets the GC below retire
        // any rows they previously had.
        if (f.promoted) continue;
        const ref = `${input.path}#${f.subid}`;
        presentRefs.push(ref);
        const got = await index({
          tenantId: input.tenantId,
          sourceKind: f.kind === "run" ? "run" : "manual",
          sourceRef: ref,
          content: f.body,
          scope: input.scope,
          ownerUserId: input.ownerUserId,
        });
        ids.push(...got);
      }
      // GC fragments that vanished from the file (forget / hand-edit).
      await gcRemovedFragments(input.tenantId, input.path, presentRefs);
      return ids;
    },

    indexRowPointer(input) {
      return index({
        tenantId: input.tenantId,
        sourceKind: "row",
        sourceRef: `${input.table}:${input.rowId}`,
        content: input.snippet,
        entityId: input.entityId,
        noChunk: true,
      });
    },
  };
}

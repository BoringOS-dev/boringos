// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Graph tier (docs/brain.md §4.3) — typed, directed, provenance-
// tracked edges + an entity name registry, all in Postgres.
//
//   brain__entities — canonical names + aliases. Mention-matching
//                     runs against THIS registry only (no name table,
//                     no mentions). Modules register names; wikilinks
//                     register on first sight.
//   brain__edges    — (src,edge_type,dst) upsert-keyed so re-indexing
//                     never duplicates. Edges carry source_ref for
//                     lifecycle: re-indexing/deleting a source soft-
//                     deletes the edges it asserted.
//
// Auto-wired with ZERO LLM calls: `[[Entity]]` wikilinks in any
// written memory/file become `mentions` edges from the source to the
// entity. Plus a bounded registry-name scan for known-entity mentions
// (lower weight — noisier signal, kept prunable via source_ref).

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { BrainEdge } from "./types.js";

/** Extract `[[wikilink]]` targets from markdown. Returns display text. */
export function extractWikilinks(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const text = m[1].trim();
    if (text.length > 0 && text.length <= 200) out.add(text);
  }
  return [...out];
}

/** Normalize a display name to a stable slug used as the entity id. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** A parsed `(src: …)` citation target (docs/brain.md §4.5). */
export interface Citation {
  dstType: string; // 'topic' | 'row' | 'memory' | 'literal'
  dstId: string;
  raw: string;
}

/**
 * Parse `(src: …)` provenance pointers from content. Forms:
 *   (src: [[Acme Corp]])           → topic:acme-corp
 *   (src: inbox_items:abc)         → row:inbox_items:abc
 *   (src: task:1234, 2026-06-12)   → row:task:1234   (trailing date dropped)
 *   (src: 60-daily/2026-06-10.md#x) → memory:<path>
 * file-side and Postgres-side provenance become the SAME fact.
 */
export function extractCitations(content: string): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const cit = parseCitationTarget(raw.trim());
    if (!cit) return;
    const key = `${cit.dstType}:${cit.dstId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cit);
  };
  // 1. Inline `(src: …)` pointers.
  for (const m of content.matchAll(/\(src:\s*([^)]+)\)/gi)) push(m[1]);
  // 2. OKF `# Citations` section (§8): parse `](target)` links until the
  //    next heading. Only inside this section — not every link is a citation.
  const cit = content.match(/^#{1,6}\s+Citations\s*$/im);
  if (cit && cit.index !== undefined) {
    const rest = content.slice(cit.index + cit[0].length);
    const nextHeading = rest.search(/^#{1,6}\s+/m);
    const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
    for (const m of section.matchAll(/\]\(([^)]+)\)/g)) push(m[1]);
  }
  return out;
}

function parseCitationTarget(inner: string): Citation | null {
  const main = inner.split(",")[0].trim(); // drop a trailing ", <date>"
  if (!main) return null;
  const wl = main.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (wl) {
    const s = slugify(wl[1]);
    return s ? { dstType: "topic", dstId: s, raw: main } : null;
  }
  if (/^https?:\/\//i.test(main)) return { dstType: "url", dstId: main, raw: main };
  // table:id pointer (inbox_items:abc, task:1234) — check BEFORE the
  // path rule so `inbox_items:abc` isn't mistaken for a path.
  const tbl = main.match(/^([a-z][\w]+):([^/\s]+)$/i);
  if (tbl) return { dstType: "row", dstId: `${tbl[1]}:${tbl[2]}`, raw: main };
  if (main.includes("/")) {
    // strip a leading bundle-relative slash for a stable dst id
    return { dstType: "memory", dstId: main.replace(/^\//, ""), raw: main };
  }
  return { dstType: "literal", dstId: main, raw: main };
}

export interface GraphWriter {
  /** Register / update a canonical entity name. Idempotent on (type,id). */
  registerEntity(input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    name: string;
    aliases?: string[];
  }): Promise<void>;

  /** Upsert one edge against the unique key — never duplicates. */
  upsertEdge(input: { tenantId: string } & BrainEdge): Promise<void>;

  /**
   * Auto-wire a source's edges from its content (§4.3). Soft-deletes
   * the source's prior edges first, so re-indexing replaces rather
   * than accretes. Returns the number of edges asserted.
   */
  wireSource(input: {
    tenantId: string;
    sourceRef: string;
    content: string;
  }): Promise<number>;

  /** Soft-delete every edge a given source asserted (file/memory delete). */
  softDeleteBySource(tenantId: string, sourceRef: string): Promise<void>;
}

export function createGraphWriter(db: Db): GraphWriter {
  return {
    async registerEntity(input) {
      // Bind aliases as a single pg array LITERAL (`{"a","b"}`) cast to
      // text[] — NOT a JS array. drizzle's `sql` interpolates a JS array
      // as a comma-separated placeholder list (for IN-clauses), so an
      // empty array would render as nothing → a `, )` syntax error.
      const aliasesLiteral = toPgTextArray(input.aliases ?? []);
      await db.execute(sql`
        INSERT INTO brain__entities (tenant_id, entity_type, entity_id, name, aliases)
        VALUES (${input.tenantId}::uuid, ${input.entityType}, ${input.entityId}, ${input.name}, ${aliasesLiteral}::text[])
        ON CONFLICT (tenant_id, entity_type, entity_id)
        DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases
      `);
    },

    async upsertEdge(input) {
      await db.execute(sql`
        INSERT INTO brain__edges
          (tenant_id, src_type, src_id, edge_type, dst_type, dst_id, weight, source_ref)
        VALUES
          (${input.tenantId}::uuid, ${input.srcType}, ${input.srcId}, ${input.edgeType},
           ${input.dstType}, ${input.dstId}, ${input.weight}, ${input.sourceRef})
        ON CONFLICT (tenant_id, src_type, src_id, edge_type, dst_type, dst_id)
        DO UPDATE SET weight = GREATEST(brain__edges.weight, EXCLUDED.weight),
                      source_ref = EXCLUDED.source_ref,
                      deleted_at = NULL,
                      updated_at = now()
      `);
    },

    async softDeleteBySource(tenantId, sourceRef) {
      await db.execute(sql`
        UPDATE brain__edges SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND source_ref = ${sourceRef}
          AND deleted_at IS NULL
      `);
    },

    async wireSource(input) {
      // Replace-on-reindex: drop the prior assertions for this source.
      await this.softDeleteBySource(input.tenantId, input.sourceRef);

      let asserted = 0;

      // 1. Wikilinks — the reliable, zero-LLM signal. Each becomes a
      //    registered topic entity + a `mentions` edge from the source.
      for (const link of extractWikilinks(input.content)) {
        const slug = slugify(link);
        if (!slug) continue;
        await this.registerEntity({
          tenantId: input.tenantId,
          entityType: "topic",
          entityId: slug,
          name: link,
        });
        await this.upsertEdge({
          tenantId: input.tenantId,
          srcType: "source",
          srcId: input.sourceRef,
          edgeType: "mentions",
          dstType: "topic",
          dstId: slug,
          weight: 1.0,
          sourceRef: input.sourceRef,
        });
        asserted++;
      }

      // 2. Known-entity mention scan — bounded, lower weight. Match
      //    registered entity NAMES that appear as whole words in the
      //    content. Capped so a huge corpus doesn't make this O(n*m)
      //    expensive; weighted 0.5 because it's a noisier signal
      //    (decision: keep provenance so bad edges are prunable).
      const lowered = input.content.toLowerCase();
      const named = (await db.execute(sql`
        SELECT entity_type, entity_id, name
        FROM brain__entities
        WHERE tenant_id = ${input.tenantId}::uuid
        LIMIT 500
      `)) as unknown as Array<{ entity_type: string; entity_id: string; name: string }>;
      for (const e of named) {
        const name = e.name.toLowerCase();
        if (name.length < 3) continue; // skip noise like "AI" matching everywhere
        // whole-word-ish containment
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
        if (!re.test(lowered)) continue;
        await this.upsertEdge({
          tenantId: input.tenantId,
          srcType: "source",
          srcId: input.sourceRef,
          edgeType: "mentions",
          dstType: e.entity_type,
          dstId: e.entity_id,
          weight: 0.5,
          sourceRef: input.sourceRef,
        });
        asserted++;
      }

      // 3. Citation provenance (§4.5): `(src: …)` pointers → `cites`
      //    edges, so a promoted fact's file-side citation and its
      //    Postgres-side provenance are the same fact.
      for (const cit of extractCitations(input.content)) {
        await this.upsertEdge({
          tenantId: input.tenantId,
          srcType: "source",
          srcId: input.sourceRef,
          edgeType: "cites",
          dstType: cit.dstType,
          dstId: cit.dstId,
          weight: 1.0,
          sourceRef: input.sourceRef,
        });
        asserted++;
      }

      return asserted;
    },
  };
}

// ── Traversal (read side — powers brain.graph) ───────────────────────

export interface GraphNode {
  type: string;
  id: string;
}

export interface TraversalResult {
  /** The edges discovered, in BFS order. */
  edges: BrainEdge[];
  /** Distinct nodes reached, keyed `type:id`. */
  nodes: GraphNode[];
}

export interface GraphReader {
  /** One-hop neighbours of a node. Direction controls edge orientation. */
  neighbors(input: {
    tenantId: string;
    type: string;
    id: string;
    direction?: "out" | "in" | "both";
    edgeType?: string;
  }): Promise<BrainEdge[]>;

  /** Multi-hop BFS traversal from a seed node up to `depth` hops. */
  traverse(input: {
    tenantId: string;
    type: string;
    id: string;
    depth?: number;
    direction?: "out" | "in" | "both";
    edgeType?: string;
    maxNodes?: number;
  }): Promise<TraversalResult>;
}

export function createGraphReader(db: Db): GraphReader {
  async function oneHop(
    tenantId: string,
    type: string,
    id: string,
    direction: "out" | "in" | "both",
    edgeType?: string,
  ): Promise<BrainEdge[]> {
    const typeFilter = edgeType ? sql`AND edge_type = ${edgeType}` : sql``;
    const dirFilter =
      direction === "out"
        ? sql`(src_type = ${type} AND src_id = ${id})`
        : direction === "in"
          ? sql`(dst_type = ${type} AND dst_id = ${id})`
          : sql`((src_type = ${type} AND src_id = ${id}) OR (dst_type = ${type} AND dst_id = ${id}))`;
    const rows = (await db.execute(sql`
      SELECT src_type, src_id, edge_type, dst_type, dst_id, weight, source_ref
      FROM brain__edges
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        AND ${dirFilter} ${typeFilter}
      ORDER BY weight DESC
      LIMIT 200
    `)) as unknown as Array<{
      src_type: string;
      src_id: string;
      edge_type: string;
      dst_type: string;
      dst_id: string;
      weight: number;
      source_ref: string | null;
    }>;
    return rows.map((r) => ({
      srcType: r.src_type,
      srcId: r.src_id,
      edgeType: r.edge_type,
      dstType: r.dst_type,
      dstId: r.dst_id,
      weight: r.weight,
      sourceRef: r.source_ref,
    }));
  }

  return {
    neighbors(input) {
      return oneHop(
        input.tenantId,
        input.type,
        input.id,
        input.direction ?? "both",
        input.edgeType,
      );
    },

    async traverse(input) {
      const depth = Math.min(Math.max(input.depth ?? 2, 1), 5);
      const maxNodes = Math.min(input.maxNodes ?? 100, 500);
      const direction = input.direction ?? "both";

      const seen = new Set<string>([`${input.type}:${input.id}`]);
      const nodes: GraphNode[] = [{ type: input.type, id: input.id }];
      const edges: BrainEdge[] = [];
      const edgeSeen = new Set<string>();

      let frontier: GraphNode[] = [{ type: input.type, id: input.id }];
      for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
        const next: GraphNode[] = [];
        for (const node of frontier) {
          if (nodes.length >= maxNodes) break;
          const hops = await oneHop(
            input.tenantId,
            node.type,
            node.id,
            direction,
            input.edgeType,
          );
          for (const e of hops) {
            const ekey = `${e.srcType}:${e.srcId}|${e.edgeType}|${e.dstType}:${e.dstId}`;
            if (!edgeSeen.has(ekey)) {
              edgeSeen.add(ekey);
              edges.push(e);
            }
            // The "other end" of this edge relative to `node`.
            const other =
              e.srcType === node.type && e.srcId === node.id
                ? { type: e.dstType, id: e.dstId }
                : { type: e.srcType, id: e.srcId };
            const okey = `${other.type}:${other.id}`;
            if (!seen.has(okey) && nodes.length < maxNodes) {
              seen.add(okey);
              nodes.push(other);
              next.push(other);
            }
          }
        }
        frontier = next;
      }

      return { edges, nodes };
    },
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Render a JS string[] as a Postgres array literal: `{"a","b"}`. */
function toPgTextArray(values: string[]): string {
  if (values.length === 0) return "{}";
  const escaped = values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`);
  return `{${escaped.join(",")}}`;
}

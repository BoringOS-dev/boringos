// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Brain engine — shared types. See docs/brain.md for the canonical
// plan these implement.

/** The fixed embedding dimension across the whole ladder (decision #8). */
export const EMBED_DIMS = 768;

/**
 * The embedder ladder rung (docs/brain.md §9). A `model` of `null`
 * means the FTS floor — no embeddings, the engine answers from
 * Postgres full-text search alone. Every hosted rung emits exactly
 * `EMBED_DIMS` (768) dimensions so switching providers never touches
 * the column type.
 */
export interface Embedder {
  /** Model id stamped per row (`embed_model`). `null` = FTS floor. */
  readonly model: string | null;
  /** Always 768 for hosted rungs; ignored on the floor. */
  readonly dims: number;
  /** Embed a batch. Returns one 768-vector per input. Empty on floor. */
  embed(texts: string[]): Promise<number[][]>;
}

/** What the engine learned about the live Postgres at boot (cached). */
export interface BrainCapabilities {
  /** `vector` extension installed AND the embedding column exists. */
  hasVector: boolean;
  /** `pg_trgm` installed — enables fuzzy entity-name matching. */
  hasTrgm: boolean;
}

/** A single retrieval hit from the semantic tier. */
export interface BrainHit {
  id: string;
  content: string;
  sourceKind: string;
  sourceRef: string | null;
  chunkIndex: number;
  importance: number;
  score: number;
  /** Which retrieval signals fired for this hit (debugging + citations). */
  matched: { fts?: number; vector?: number };
  scope: string;
  createdAt: Date | null;
}

/** A typed graph edge as stored in `brain__edges`. */
export interface BrainEdge {
  srcType: string;
  srcId: string;
  edgeType: string;
  dstType: string;
  dstId: string;
  weight: number;
  sourceRef: string | null;
}

export type MemoryScope = "tenant" | "user";

export interface IndexInput {
  tenantId: string;
  /** 'file'|'row'|'comment'|'run'|'manual'|'distilled' */
  sourceKind: string;
  /** drive path / '<table>:<id>' / run id — the replace-on-reindex key. */
  sourceRef: string;
  content: string;
  kind?: string;
  importance?: number;
  entityId?: string;
  scope?: MemoryScope;
  ownerUserId?: string;
  /** Override chunking — e.g. row pointers index as one snippet. */
  noChunk?: boolean;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embedder ladder (docs/brain.md §9):
//
//   Floor    — none. Postgres FTS only. Boots keyless, still answers.
//   Default  — BYOK hosted. OpenAI text-embedding-3-small @ 768 dims
//              via EMBEDDING_API_KEY (+ EMBEDDING_PROVIDER for others).
//   Future   — local in-process ONNX. Not built in v1; the interface
//              + fixed 768 dims make it a drop-in later.
//
// Every rung emits exactly 768 dims (decision #8) so switching
// providers never changes the column type. The framework holds no
// model of its own — this is the ONE place the brain talks to a
// hosted model, and only for embeddings (cheap, deterministic-ish),
// never for synthesis (that's a CLI agent's job, §5).

import { EMBED_DIMS, type Embedder } from "./types.js";

/** The FTS floor — no embeddings. `model` is null; `embed` is a no-op. */
export const nullEmbedder: Embedder = {
  model: null,
  dims: EMBED_DIMS,
  async embed() {
    return [];
  },
};

export interface OpenAIEmbedderConfig {
  apiKey: string;
  model?: string;
  /** Override the API base (Azure / proxy / compatible endpoints). */
  baseUrl?: string;
}

/**
 * OpenAI (and OpenAI-compatible) embedder. Requests 768 dims via the
 * `dimensions` param so the column type never changes. Batches up to
 * the API limit; retries once on a transient 429/5xx.
 */
export function createOpenAIEmbedder(config: OpenAIEmbedderConfig): Embedder {
  const model = config.model ?? "text-embedding-3-small";
  const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");

  async function call(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model, input: texts, dimensions: EMBED_DIMS }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`embedding request failed (${res.status}): ${body.slice(0, 300)}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }

  return {
    model,
    dims: EMBED_DIMS,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      // OpenAI accepts large batches; we cap defensively and chunk.
      const BATCH = 96;
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const slice = texts.slice(i, i + BATCH);
        try {
          out.push(...(await call(slice)));
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 429 || (status && status >= 500)) {
            await new Promise((r) => setTimeout(r, 750));
            out.push(...(await call(slice)));
          } else {
            throw err;
          }
        }
      }
      return out;
    },
  };
}

/**
 * Resolve the configured embedder from the environment.
 *
 *   EMBEDDING_API_KEY      — turns on the semantic tier (default OpenAI)
 *   EMBEDDING_PROVIDER     — 'openai' (default). Voyage/Gemini reserved.
 *   EMBEDDING_MODEL        — override the model id
 *   EMBEDDING_BASE_URL     — override the API base (compatible endpoints)
 *
 * No key → the FTS floor. Boot never depends on this resolving to a
 * hosted rung (decision #4).
 */
export function resolveEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const apiKey = env.EMBEDDING_API_KEY;
  if (!apiKey) return nullEmbedder;
  const provider = (env.EMBEDDING_PROVIDER ?? "openai").toLowerCase();
  if (provider === "openai") {
    return createOpenAIEmbedder({
      apiKey,
      model: env.EMBEDDING_MODEL,
      baseUrl: env.EMBEDDING_BASE_URL,
    });
  }
  // Voyage / Gemini share the 768-dim contract; their HTTP shapes
  // differ. Until those rungs are wired, fall back to the floor with
  // a clear signal rather than silently mis-embedding.
  console.warn(
    `[brain] EMBEDDING_PROVIDER="${provider}" not yet implemented — running on the FTS floor. ` +
      `Use EMBEDDING_PROVIDER=openai (or an OpenAI-compatible EMBEDDING_BASE_URL) for v1.`,
  );
  return nullEmbedder;
}

/** Render a JS number[] as a pgvector literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

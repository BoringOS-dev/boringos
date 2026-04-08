import type { MemoryProvider, MemoryMeta, RecallOptions, PrimeOptions, RecallResult } from "./types.js";
import { MemoryConnectionError, MemoryAuthError } from "./errors.js";

export interface HebbsMemoryConfig {
  endpoint: string;
  apiKey: string;
  workspace?: string;
  timeout?: number;
}

export function createHebbsMemory(config: HebbsMemoryConfig): MemoryProvider {
  const endpoint = config.endpoint.replace(/\/$/, "");
  const apiKey = config.apiKey;
  const timeout = config.timeout ?? 10_000;
  const workspace = config.workspace;

  function basePath(): string {
    return workspace ? `/v1/workspaces/${encodeURIComponent(workspace)}` : "/v1";
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new MemoryConnectionError(
        `Memory server unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new MemoryAuthError(`Memory auth failed (${res.status}): invalid API key`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MemoryConnectionError(
        `Memory request failed: ${method} ${path} → ${res.status}${text ? `: ${text}` : ""}`,
      );
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  const provider: MemoryProvider = {
    name: "hebbs",

    async remember(content: string, meta?: MemoryMeta): Promise<string> {
      const result = await request<{ id: string }>("POST", `${basePath()}/memories`, {
        content,
        entity_id: meta?.entityId,
        importance: meta?.importance ?? 0.5,
        tags: meta?.tags,
        scope: meta?.scope,
      });
      return result.id;
    },

    async recall(query: string, options?: RecallOptions): Promise<RecallResult[]> {
      const res = await request<{ results: Array<{ id: string; content: string; score: number; tags?: string[]; created_at?: string }> }>(
        "POST",
        `${basePath()}/recall`,
        {
          cue: query,
          entity_id: options?.entityId,
          limit: options?.limit,
          scope: options?.scope,
        },
      );
      return (res.results ?? [])
        .filter((r) => !options?.minScore || r.score >= options.minScore)
        .map((r) => ({
          id: r.id,
          content: r.content,
          score: r.score,
          meta: r.tags ? { tags: r.tags } : undefined,
          createdAt: r.created_at ? new Date(r.created_at) : undefined,
        }));
    },

    async prime(context: string, options?: PrimeOptions): Promise<string | null> {
      const res = await request<{ results: Array<{ content: string }> }>(
        "POST",
        `${basePath()}/prime`,
        {
          entity_id: options?.entityId,
          similarity_cue: context,
          max_memories: options?.limit ?? 20,
        },
      );
      const results = res.results ?? [];
      if (results.length === 0) return null;
      return results.map((r) => r.content).join("\n\n---\n\n");
    },

    async forget(memoryId: string): Promise<void> {
      await request<void>("DELETE", `${basePath()}/memories/${encodeURIComponent(memoryId)}`);
    },

    async ping(): Promise<boolean> {
      try {
        await request<unknown>("GET", "/v1/system/health");
        return true;
      } catch {
        return false;
      }
    },

    skillMarkdown() {
      return MEMORY_SKILL;
    },
  };

  return provider;
}

const MEMORY_SKILL = `# Memory Skill

You have access to cognitive memory — a system that stores, connects, and retrieves organizational knowledge.

## When to Remember

**ALWAYS remember:**
- Key discoveries and findings (competitor pricing, technical decisions, user preferences)
- Decisions made and WHY (rationale matters more than the choice itself)
- Patterns you notice (recurring issues, common requests, trends)
- Important facts that will be useful across tasks

**NEVER remember:**
- Routine status updates ("started working on X")
- Temporary debug information
- Raw data dumps (store a summary instead)
- Anything already stored as a document or work product

## How to Structure Memories

Lead with the key fact, not the context. Be concise — under 500 characters.

Include: **WHAT** (the fact), **WHO** (relevant entities), **WHEN** (timeframe), **WHY IT MATTERS** (impact).

## Importance Guide

- **0.9** — Decisions, user preferences, critical strategy findings
- **0.7** — Useful facts, verified information
- **0.5** — Observations, supplementary details
- **0.3** — Minor details, background information

## Recall Strategies

- **similarity** (default) — semantic search, best for knowledge lookup
- **temporal** — recency-weighted, best for recent events
- **causal** — follows cause-effect chains, best for understanding decisions
- **analogical** — finds similar situations, best for pattern matching

**Before starting any research task:** Recall what's already known to avoid duplicate work.
`;

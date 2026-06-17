# @boringos/brain

The owned, Postgres-native **foundation-brain** engine for BoringOS — your company's books, relationships, and memory in one store, asked through `brain.ask` and four retrieval tiers. This package is the moat: embedder ladder, hybrid retrieval, typed graph, files-as-system-of-record mirror.

- **Canonical plan:** [`docs/brain.md`](../../../docs/brain.md) — *what the brain is and why*.
- **How it works + how to test:** [`docs/brain-implementation.md`](../../../docs/brain-implementation.md).
- **This README:** *exactly what the system needs to run, what is and isn't active, and every gap still pending.* No shortcuts — read it before claiming "RAG is on."

---

## TL;DR — is RAG on?

There are **two retrieval modes**, chosen automatically at boot:

| Mode | When | What you get |
|---|---|---|
| **Semantic (real vector RAG)** | Postgres **with pgvector** + an **embedding API key** | vector cosine + full-text + reciprocal-rank fusion. Matches on *meaning*. |
| **FTS floor** (fallback) | anything missing above | Postgres full-text (keyword/BM25) only. Matches on *words*, not meaning. Still answers; **not** semantic RAG. |

**On a default local install (embedded Postgres, no key) the brain runs on the FTS floor.** Semantic vector RAG is built and ready but **dormant** until both requirements below are met. The boot log tells you which mode is live:

```
[brain-migrate] pgvector not available — brain runs on the Postgres FTS floor (decision #2).
```

---

## System requirements — what you NEED

### To run at all (FTS floor)
- **Node ≥ 22**, TypeScript ESM.
- **PostgreSQL** with **`pg_trgm`** (ships with embedded Postgres). Tables `brain__memories`, `brain__edges`, `brain__entities`, `brain__access_tokens` are created by the **global migrator** (`@boringos/db`), once per host.
- Nothing else. Keyless installs boot and answer.

### To run real semantic RAG (the product) — BOTH are mandatory, no shortcuts

1. **PostgreSQL with the `pgvector` extension.**
   The embedded distro (`embedded-postgres@18.1.0-beta.16`) ships `pg_trgm` but **NOT** `pgvector` — there is no `vector.control` in the binary. So you must either:
   - point at an **external Postgres that has pgvector** (`PG_EMBEDDED=false DATABASE_URL=…`), **or**
   - stage a prebuilt pgvector artifact into the embedded extension dir before boot *(per-platform artifacts are **not yet shipped** — see Gaps)*.

   When pgvector is present, the migrator adds `embedding vector(768)` + an HNSW index on the next boot — **no manual migration**.

2. **An embedding API key.** Without it nothing is embedded even if pgvector exists.

### Environment variables

| Var | Required for | Default | Notes |
|---|---|---|---|
| `EMBEDDING_API_KEY` | semantic tier | — | turns on embeddings. No key ⇒ FTS floor. |
| `EMBEDDING_PROVIDER` | — | `openai` | `openai` is the only **implemented** rung today. `voyage`/`gemini` are reserved and currently **fall back to the floor with a warning**. |
| `EMBEDDING_MODEL` | — | `text-embedding-3-small` | must emit **768** dims (decision #8). |
| `EMBEDDING_BASE_URL` | — | OpenAI | for Azure / OpenAI-compatible endpoints. |
| `DATABASE_URL` | external PG | — | use a pgvector-capable Postgres for the semantic tier. |
| `PG_EMBEDDED` | — | auto | `false` forces external (`DATABASE_URL` wins); `true` forces embedded (FTS floor). |

### Turn full RAG on

```bash
PG_EMBEDDED=false DATABASE_URL=postgres://…@host/db   # a Postgres with `CREATE EXTENSION vector`
EMBEDDING_API_KEY=sk-…                                # OpenAI text-embedding-3-small @ 768d
# restart — brain.search now reports tier:"semantic (vector+FTS)"
```

Switching from floor → semantic needs **no schema change**: the column is added defensively, and existing FTS-only rows (carrying `embed_model = null`) are re-embedded lazily *(re-embed job pending — see Gaps)*.

---

## What is built and active

- **Schema** — `brain__{memories,edges,entities,access_tokens}` + `pg_trgm`, defensive pgvector (degrades to FTS floor; boot never fails).
- **Engine** (`@boringos/brain`) — embedder ladder (FTS floor + OpenAI 768d), heading-aware chunker, hybrid retrieval (vector + FTS + RRF + recency/importance), typed graph (entities/edges, `[[wikilink]]` + known-entity auto-wiring, zero LLM, BFS traversal), indexer (chunk + mirror + replace-on-reindex + content-unchanged short-circuit), pgvector `MemoryProvider`.
- **Tools** (`brain` module) — `brain.ask` (spawn-and-wait synthesis), `brain.search`, `brain.query` (read-only SQL), `brain.graph`, `brain.remember`, `brain.forget`, `brain.approval_status`.
- **Wiring** — brain is the default `MemoryProvider`; `memory.*` flows through it; the post-run reindex mirrors memory files into the brain; the old `DriveManager` truncating sync is removed.

---

## Pending gaps — the honest, complete list

Grouped by what closing them requires. Nothing here is hidden behind "it works on my machine."

### A. Infrastructure (no code — you provide it)
- **pgvector for the embedded path** — per-platform prebuilt artifacts are **not shipped**; embedded installs can't do vectors without an external pgvector Postgres. *(Plan decision #2 / risk.)*
- **Embedding key** — no key ⇒ FTS floor. *(By design — BYOK.)*

### B. Built but inactive / not wired
- **Access-plane controls** — `brain__access_tokens` table exists but **nothing mints, verifies, or enforces** connection profiles (tool allowlist, tier/namespace scope, approval gates, budget, revocation). *(Plan §8.)*
- ~~**Operational-row ingestion**~~ — **DONE.** `brain.ingest_rows` + an hourly routine index `inbox_items`/`tasks`/`task_comments`/`agent_runs` + every `<module>__*` table as by-reference row pointers (snippet only); `brain.search`/`brain.ask` now reach live data. *(Decision #11.)*
- **Lazy re-embed / model-drift job** — referenced in comments, **not built**. Mixed-`embed_model` rows won't self-heal. *(Plan §13 — "ship with v1".)*
- **Voyage / Gemini embedders** — resolver stubs them and falls back to the floor; only OpenAI is implemented. *(Plan §9.)*

### C. Subsystems not built (full plan items)
- **MCP access plane** — `@boringos/connector-mcp` (stdio + HTTP, tools/resources/prompts, scoped bearer/OAuth). The whole external surface. *(Plan §8, §12.)* REST `/api/tools/brain.*` is the only external path today.
- **`ledger` + `ads` reference modules** — the structured-tier worked examples. *(Plan §4.1, §12.)*
- ~~**Distillation routine**~~ — **DONE (Unit 2).** `distill()` + the `brain.distill` tool + a seeded weekly cron routine (→ a one-block workflow): dedup-reinforce (near-duplicate facts collapse into one canonical row, `access_count`/`importance` merge), promote durable facts into `10-domains/`/`20-decisions/` with `MEMORY.md` pointers, retire superseded versions to `99-archive/`, write the `70-weekly/` synthesis. Deterministic + zero-LLM + idempotent. *(Plan §4.2/§4.5.)*
- **Curator pass (lint routine)** — contradictions, stale claims, orphans, oversized files, `MEMORY.md` pointer drift. *(Plan §4.5.)*
- **Memory-tree v2** — **DONE (Units 1–3).** Canonical numbered layout `10-domains/`…`99-archive/`; `remember` appends a fragment to `60-daily/YYYY-MM-DD.md`; per-session checkpoints append there too; fragment index + `forget`-strike + GC; **progressive compression** via the weekly distillation routine; **curator/lint** via the daily routine — `(src: …)` citations parsed into `cites` provenance edges, contradictions surfaced as `CONFLICT:` blocks, >200-line files split + repointed, orphan/broken pointers fixed, stale unpromoted daily flagged; scaffold + SKILLs teach read/write order. *(Plan §4.5.)*
- **Slugged drive paths** — `tasks/<id8>-<slug>/` / `projects/<id8>-<slug>/`. Still `tasks/<uuid>/`. *(Plan §4.4.)*
- **Persona-bundle Memory & Drive guidance** — only the copilot persona is taught; the other 14 bundles have **no** Memory/Drive section. *(Plan decision #10.)*
- **Code-level module interop** — `ctx.callTool('<module>.<tool>')` on the SDK `ToolContext` is **not added**; modules still can't call each other's tools in-process. *(Plan decision #12.)*
- ~~**Core-schema SKILL**~~ — **DONE** (as OKF, better than a SKILL): `brain.sync_schema` emits OKF `type: table` docs (live columns) for core + `<module>__*` tables into `50-schema/`, indexed + findable; `Module.dataSchema` lets modules enrich descriptions. *(§4.1, decisions #11/#12.)*
- **Edge-type registry + module-registered entities** — `registerEntity()` exists but no module (CRM, ledger) registers names; no module-declared edge types. *(Plan §4.3.)*
- **Reranker** — the hybrid ladder has no rerank stage. *(Plan §4.2, §9.)*
- **Structured citation enforcement** — `brain.ask` *instructs* the agent (via SKILL/protocol) to cite every claim and state gaps, but there's **no structural enforcement** and the `work_products.record(kind:'citation')` hook isn't wired. Quality depends on the agent following the protocol. *(Plan §5.)*
- **Conflict surfacing + `(src: …)` citation parsing** — `[[wikilinks]]` are parsed into the graph; the `(src: …)` fact-citation convention and `CONFLICT:` blocks are **not** parsed/enforced. *(Plan §4.5.)*
- **gbrain opt-in provider** — not built. *(Plan decision #6, §12.)*
- **Eval harness (the launch gate, §10)** — retrieval-quality, answer/citation, exactness, contradiction/gap, memory-hygiene, multi-tenancy-fuzz evals are **not** built. Integration tests cover core correctness; the formal gate does not exist.
- **Public strategy doc** on docs.hebbs.ai. *(Plan §12.)*

### D. Hardening deferred until external exposure (intentional, plan decision #9)
- **RLS policies** keyed to `current_setting('app.tenant_id')` on every `brain__*` + module table. Every table already carries `tenant_id`, so this is a no-migration add.
- **Dedicated least-privilege Postgres role** — `brain.query` currently uses a **read-only transaction** (`SET TRANSACTION READ ONLY` + `statement_timeout`, verified to block writes/DDL and cancel long queries), **not** a locked-down DB role. A read-only txn does not restrict catalog reads, `pg_read_file`, etc. — harden to a true role before exposing SQL beyond localhost.
- **Tenant scoping of `brain.query`** — raw SQL is tenant-*unscoped* by design today (trusted internal agents); callers must filter by `tenant_id`. RLS closes this for external tokens.
- **Dedicated synthesis lane** — `brain.ask` runs on the main engine queue, not a separate concurrency-2 lane; under load, asks compete with agent runs (the 120s timeout + `{taskId}` fallback bound the blast radius).

---

## Quick API

```ts
import { createBrainMemory, createIndexer, searchHybrid, createGraphReader } from "@boringos/brain";

// Default MemoryProvider (the host wires this automatically):
const memory = createBrainMemory({ drive, db /*, embedder */ });
await memory.remember("Acme signed [[net-30]] terms.", { tenantId, scope: "tenant" });
const hits = await memory.recall("payment terms for Acme", { tenantId });
```

Internal agents and external tools reach the same surface via `POST /api/tools/brain.<name>`.

---

## Tests

```bash
pnpm -r build
npx vitest run tests/brain-engine.test.ts tests/brain-integration.test.ts   # 20 tests
node scripts/verify-brain.mjs                                               # live HTTP check
```

See [`docs/brain-implementation.md`](../../../docs/brain-implementation.md) §5 for the full testing guide (incl. enabling the vector tier and the macOS shared-memory gotcha).

License: AGPL-3.0-or-later.

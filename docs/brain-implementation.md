# BoringOS Brain — Implementation & Testing Guide

> Companion to [`brain.md`](brain.md) (the canonical plan). That doc says **what the Brain is**; this one says **what is actually built in the codebase right now, how the pieces connect, and how to test it**. Re-read `brain.md` before extending; update this doc when the implementation moves.

Status: **core spine shipped and verified end-to-end.** The retrieval substrate (schema + engine + tools + wiring) is built, tested, and running on the local instance. Peripheral modules (MCP access plane, ledger/ads, distillation/curator routines, memory-tree-v2 migration, full eval harness, RLS) are scoped as next steps — see [§7](#7-whats-deferred-and-why).

---

## 1. What was built

| Piece | Where | What it does |
|---|---|---|
| **Brain schema** | `packages/@boringos/db/src/migrate.ts` | `brain__memories`, `brain__edges`, `brain__entities`, `brain__access_tokens` + extensions, in the **global** migrator (decision #7). Defensive pgvector tier (`ensureBrainVectorTier`) — degrades to the FTS floor when pgvector is absent. |
| **`@boringos/brain`** | `packages/@boringos/brain/` | The owned engine: embedder ladder, heading-aware chunker, hybrid retrieval (vector+FTS+RRF), typed graph (entities/edges/wikilinks/traversal), indexer (chunk+mirror+replace-on-reindex), and the `createBrainMemory` `MemoryProvider`. |
| **`brain` module** | `packages/@boringos/core/src/modules/brain.ts` + `brain/SKILL.md` | The `brain.*` tool surface: `ask`, `search`, `query`, `graph`, `remember`, `forget`, `approval_status`. |
| **Wiring** | `boringos.ts`, `memory-checkpoint.ts`, `drive/manager.ts` | Brain is the **default `MemoryProvider`**; the dead `DriveManager` memory sync is removed (decision #5); the post-run reindex hook mirrors memory files into the brain (§4.4). |
| **Tests** | `tests/brain-engine.test.ts`, `tests/brain-integration.test.ts` | 12 unit + 6 integration tests, green. |
| **Live verifier** | `scripts/verify-brain.mjs` | Exercises the `brain.*` tools over real HTTP against the running dev-server. |

---

## 2. The shape, end to end

```
 brain.remember / memory.remember          drive.write tool / agent native FS write
            │                                          │
            ▼                                          ▼
   createBrainMemory.remember()             post-run memory-checkpoint reindex
   • writes the markdown FILE (SoR)          • walks */memory/ for files touched this run
   • indexer.index(sourceKind='manual')      • indexer.indexFile(sourceKind='file')
            │                                          │
            └──────────────┬───────────────────────────┘
                           ▼
                 @boringos/brain  indexer.index()
                 • soft-delete prior rows+edges by source_ref  (replace-on-reindex)
                 • chunkContent()  → heading-aware ~1k-token chunks
                 • embedder.embed() → 768-d vectors  (skipped on the FTS floor)
                 • INSERT brain__memories (content + fts tsvector [+ embedding])
                 • graph.wireSource() → [[wikilinks]] + known-entity mentions
                           │
            ┌──────────────┴───────────────────────────┐
            ▼                                            ▼
   brain__memories (semantic+files tier)        brain__edges + brain__entities (graph tier)
            │                                            │
   searchHybrid(): vector + FTS + RRF            graphReader.traverse(): BFS reverse/multi-hop
            │                                            │
   brain.search / memory.recall                  brain.graph
            └──────────────┬───────────────────────────┘
                           ▼
                  brain.ask  (synthesis)
                  • pre-fetch grounding (searchHybrid)
                  • spawn the copilot on a synthesis task (spawn-and-wait)
                  • the CLI agent orchestrates query/search/graph, cites, states gaps
                  • poll task comments for the reply → return {answer, citations}
```

Everything lives in **one embedded Postgres**. There is no second datastore (non-goal #1).

---

## 3. The four tiers, as implemented

- **Structured** — `brain.query` runs read-only SQL over the live operational tables (`inbox_items`, `tasks`, `task_comments`, `agent_runs`) and any module's `<module>__*` tables. Read-only is enforced by Postgres (`SET TRANSACTION READ ONLY` + `statement_timeout`), never by parsing the query (decision #9). Numbers trace to rows.
- **Semantic** — `brain__memories` with a stored `tsvector` (FTS, always present) and an optional `embedding vector(768)` (when pgvector is installed). `searchHybrid()` fuses vector + FTS with reciprocal-rank fusion (RRF, k=60) plus a small recency/importance bump. Chunked heading-aware so citations resolve to a passage.
- **Graph** — `brain__edges` (typed, directed, upsert-keyed, soft-deletable) + `brain__entities` (name registry). Auto-wired from `[[wikilinks]]` (weight 1.0) and a bounded known-entity name scan (weight 0.5) — **zero LLM calls**. `brain.graph` does reverse lookup + multi-hop BFS.
- **Files** — the Drive markdown memory tree stays the system of record. The brain indexes it on write (via `remember()` and the post-run reindex hook) and soft-deletes the mirror on file delete. `source_ref` is the drive path, so file-side and Postgres-side provenance are the same fact.

### The embedder ladder (`embedder.ts`)

| Rung | Trigger | Behaviour |
|---|---|---|
| **Floor** | no `EMBEDDING_API_KEY`, or no pgvector | Postgres FTS only. Boots keyless, still answers. |
| **Default** | `EMBEDDING_API_KEY` (+ pgvector) | OpenAI `text-embedding-3-small` @ **768 dims** via the `dimensions` param. `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_BASE_URL` override. |
| **Future** | — | local ONNX. Interface + fixed 768 dims make it a drop-in (decision #8). |

This is the **only** place the framework talks to a hosted model, and only for embeddings — never synthesis (that's a CLI agent's job, decision in CLAUDE.md + §5).

### FTS-floor degradation (the reality check, decision #2)

The embedded Postgres distro (`embedded-postgres@18.1.0-beta.16`) ships `pg_trgm` but **not** `pgvector`. So on a default local install:

- The migrator's `CREATE EXTENSION vector` fails → caught → the `embedding` column + HNSW index are **not** created. Boot does not fail.
- `probeCapabilities()` checks for the `embedding` column at runtime and returns `hasVector: false`.
- `searchHybrid()` skips the vector arm and answers from FTS alone.
- Adding pgvector later (external `DATABASE_URL`, or a staged artifact) lights up the semantic tier on the next boot with **no schema migration** — the column is added defensively, `embed_model` drift is re-embedded lazily.

---

## 4. The `brain.*` tool surface

All dispatched at `POST /api/tools/brain.<name>`, Zod-validated, `tool_calls`-audited, tenant-scoped.

| Tool | Inputs | Returns |
|---|---|---|
| `brain.ask` | `question`, `wait?`, `timeoutMs?` | Synthesized cited answer + gaps (spawns copilot synthesis run; `{taskId}` on `wait:false`/timeout). |
| `brain.search` | `query`, `limit?`, `scope?`, `entityId?` | Hybrid retrieval hits (`tier` tells you floor vs semantic). |
| `brain.query` | `sql`, `maxRows?` | Read-only SQL rows. Writes/DDL → `permission_denied`. |
| `brain.graph` | `type`, `id`, `direction?`, `edgeType?`, `depth?` | `{ nodes, edges }` from a BFS traversal. |
| `brain.remember` | `content`, `scope?`, `importance?`, `tags?`, `entityId?` | `{ memoryId, scope }` — writes the file + indexes it. |
| `brain.forget` | `memoryId` | Soft-deletes mirror + edges, removes the file. |
| `brain.approval_status` | `approvalId` | Resolution of a gated call (v1 reads the approval-as-task model). |

`memory.{remember,recall,forget}` are unchanged in shape but now flow through the brain provider — recall is hybrid retrieval instead of regex grep, with zero pipeline changes (decision #10: `prime()` still returns `null`, agents read their own tree).

---

## 5. How to test

### a. Unit + integration (fast, deterministic)

```bash
pnpm install
pnpm -r build                 # build first — embedded PG migration runs from compiled db
npx vitest run tests/brain-engine.test.ts tests/brain-integration.test.ts
```

- `brain-engine.test.ts` (12 tests, no DB) — chunker boundaries/overlap, wikilink extraction, slug normalization, the embedder ladder, vector-literal rendering.
- `brain-integration.test.ts` (6 tests, real embedded Postgres) — proves the **FTS-floor path**: capability probe returns `hasVector:false`/`hasTrgm:true`, index→search round-trip, `[[wikilink]]` auto-wiring, replace-on-reindex de-duplication, the provider `remember→recall→forget` round-trip (file = SoR + mirror), and the read-only-transaction write rejection.

Full regression sweep (everything):

```bash
pnpm test:run
```

> Known-flaky: a small number of suites intermittently fail with Postgres `CONNECTION_ENDED` on teardown — pre-existing, unrelated to the brain. Both pass in isolation.
>
> **macOS shared-memory gotcha.** The full suite spins up ~90 embedded-Postgres instances; on teardown some leave orphaned System V shared-memory segments. macOS's default `kern.sysv.shmmni` is ~32, so after enough runs new Postgres instances fail with `could not create shared memory segment: No space left on device` (this is the same root cause as the flaky `CONNECTION_ENDED`). If boots or tests start failing that way, clear the orphans:
> ```bash
> ipcs -m | awk '/^m/ {print $2}' | while read id; do ipcrm -m "$id" 2>/dev/null; done   # only when no Postgres you care about is running
> ```

### b. Live verification against the running instance

The dev-server boots embedded Postgres + the full module set. Upgrading the local deployment is just a rebuild + restart — the brain migration is **additive** (`IF NOT EXISTS`), so no data is dropped:

```bash
pnpm -r build
# stop the old dev-server + its embedded PG, then:
node --env-file-if-exists=.env.local scripts/dev-server.mjs   # PORT 3030, PG 5436
```

Confirm the upgrade:

```bash
curl -s http://localhost:3030/health | python3 -m json.tool | grep -A4 '"brain"'
# boot log shows the graceful degradation on embedded PG:
#   [brain-migrate] pgvector not available — brain runs on the Postgres FTS floor (decision #2).
```

Then exercise the real HTTP tool path (mints a callback JWT with the dev secret, hits a real tenant):

```bash
node --env-file-if-exists=.env.local scripts/verify-brain.mjs
```

Expected (verified 2026-06-13 on the local instance):
1. `brain.remember` → `{ ok, memoryId, scope }`
2. `brain.search` → `tier:"fts-floor"`, the fact is retrieved
3. `brain.graph` → both `[[Project Atlas]]` and `[[Dana]]` `mentions` edges, auto-wired
4. `brain.query` → exact row counts
5. `brain.query` write → `permission_denied: cannot execute DELETE in a read-only transaction`

### c. Turning on the semantic (vector) tier

The local default runs the FTS floor. To exercise vectors:

1. Point at a Postgres with pgvector: `PG_EMBEDDED=false DATABASE_URL=postgres://…` (a `CREATE EXTENSION vector`-capable instance).
2. Set `EMBEDDING_API_KEY=sk-…` (OpenAI; or `EMBEDDING_PROVIDER`/`EMBEDDING_BASE_URL` for a compatible endpoint).
3. Restart. The migrator adds the `embedding vector(768)` column + HNSW index; `brain.search` reports `tier:"semantic (vector+FTS)"`.

New writes embed immediately; existing FTS-only rows are picked up by the lazy re-embed path (they carry `embed_model = null`).

### d. Dropping & recreating the DB (only if a migration won't apply cleanly)

The brain migration is additive and was verified to apply in place. If you ever need a clean slate (e.g. testing first-boot scaffolding):

```bash
# stop the dev-server first
rm -rf .data/postgres           # embedded data dir — destroys ALL local tenant data
node --env-file-if-exists=.env.local scripts/dev-server.mjs   # re-initialises + re-migrates
```

---

## 6. Key design decisions honored in code

- **One Postgres, no sidecar** (non-goal #1) — vector + FTS + graph + structured all in the embedded DB.
- **Files are the system of record** (decision #3) — `remember()` writes the markdown file first; Postgres is the mirror.
- **Brain schema in the global migrator** (decision #7) — `brain__*` is applied once per host, not per-tenant.
- **768 dims forever** (decision #8) — every rung emits 768; switching embedders never changes the column type.
- **Read-only role + timeout now, RLS deferred** (decision #9) — `brain.query` is enforced by a read-only transaction; every table carries `tenant_id` so RLS is a no-migration add later.
- **Rows indexed by reference** (decision #11) — `indexRowPointer` writes `source_kind:'row'`, `source_ref:'<table>:<id>'`, a snippet only; the live row stays authoritative.
- **Coupled retirement** (decision #5) — swapping the default provider to the brain and removing `DriveManager`'s `memory.remember(slice 2000)` sync landed in the same change.

---

## 7. What's deferred, and why

> **The authoritative, complete pending-gaps list lives in [`packages/@boringos/brain/README.md`](../packages/@boringos/brain/README.md)** ("Pending gaps" + "System requirements"). It's grouped by what closing each gap requires (infra / built-but-unwired / not-built / hardening) and is kept in sync with the code. The table below is a summary.

These are scoped, not forgotten — the engine is built so each slots in without schema or interface churn.

| Deferred | Rationale / hook already in place |
|---|---|
| **`@boringos/connector-mcp`** (the MCP access plane, §8) | Greenfield package. The tool surface + Zod→JSON-Schema converter + `brain__access_tokens` table already exist; the MCP server mirrors the registry. REST `/api/tools/brain.*` is the same surface and is live today. |
| **`ledger` / `ads` reference modules** (§4.1) | Worked examples, not core. `Module.schema` + the schema-as-SKILL convention + `brain.query` over `<module>__*` tables already support them. |
| **Distillation routine** (§4.2, §4.5) — *Unit 2 shipped* | `distill()` + `brain.distill` + a seeded weekly cron routine: dedup-reinforce, promote to `10-domains/`/`20-decisions/` (+ `MEMORY.md` pointers), `99-archive/` on change, `70-weekly/` synthesis. Deterministic, zero-LLM, idempotent. |
| **OKF compatibility** (docs/brain-okf-compat.md, epic #73) — *shipped* | The files tier is an OKF superset: every concept carries `type`/`resource` frontmatter (→ `kind` + `describes` edge), per-directory `index.md` + root `okf_version`, `# Citations`/`(src:)` both → `cites` edges, conformance back-fill, and `brain.export_okf` emitting an OKF-§9-conformant bundle. Verified by a live faked-email end-to-end. Keeps numbered folders, scope routing, and typed edges (all OKF-legal). |
| **Curator / lint pass** (§4.5) — *Unit 3 shipped* | `curate()` + `brain.curate` + a seeded daily cron routine: `(src: …)` → `cites` provenance edges, contradiction → `CONFLICT:` blocks (surfaced, never resolved), >200-line splits + repoint, orphan/broken-pointer fixes, missing-citation + stale-daily flags. Deterministic, idempotent. Verified by unit + integration (6) + a 12-check live HTTP run. **Note:** new routines don't backfill to already-installed tenants (install-manager skips re-install) — they seed for new tenants via `onTenantCreate`; existing tenants pick them up on module re-install/upgrade. |
| **Memory-tree v2** (§4.5) — *Unit 1 shipped* | Canonical numbered layout + write routing is built: `remember`/`memory.remember` append a fragment to today's `60-daily/YYYY-MM-DD.md`; session checkpoints append there too; fragments index per-`<path>#<subid>`, `forget` strikes the exact block, the reindex GCs vanished fragments; scaffold + SKILLs teach read/write order. Verified by 18 tests + a live HTTP check. **Still pending**: `70-weekly/` synthesis + promotion (distillation), `(src:…)`/`CONFLICT:` parsing, 200-line curator. |
| **Full eval harness** (§10) | The integration tests cover retrieval/exactness/graph correctness; the seeded retrieval-regression + answer-citation + memory-hygiene evals are the launch-gate formalization. |
| **`brain.ask` dedicated synthesis lane** (§5) | `brain.ask` is implemented spawn-and-wait against the main engine + copilot, with the `{taskId}` async fallback. The separate concurrency-2 lane is a refinement (keeps asks off the agent queue under load). |
| **RLS policies** (decision #9) | Deferred until an MCP/REST token is exposed beyond localhost. `tenant_id` is on every table already. |
| **gbrain opt-in provider** (decision #6) | Optional interop, isolated behind `MemoryProvider`. |

---

## 8. Adversarial review & hardening

The implementation went through a multi-agent adversarial review (4 reviewers — SQL-safety, engine-correctness, plan-fidelity, wiring-side-effects — each finding independently verified). Two findings were correctly dismissed (the `reinforce` empty-array guard already exists; the dedicated synthesis lane is a documented deferral). Five were real and fixed:

1. **`brain.ask` could return a human comment as the answer** (high) — the spawn-and-wait poll now filters `author_agent_id = copilot` so only the agent's reply counts.
2. **`brain.ask` reply race** (med) — the comment cutoff is now stamped *before* the task is created/woken, so a fast synthesis run can't be missed.
3. **Double embedding cost** (med) — `indexer.index()` now short-circuits when the live rows already hold exactly the new chunks (content unchanged), so the post-run reindex never re-embeds a file `remember()` just indexed, and unchanged files across runs are free. Covered by a test.
4. **`brain.search` empty-query validation** (med) — `query` now requires `.min(1)`, matching `brain.ask`.
5. **`brain.query` statement-timeout** (high, but a reasoning error in the review) — `SET LOCAL statement_timeout` *does* cover the user query (it lasts for the remainder of the transaction). Rather than trust the argument either way, this is now **proven by a `pg_sleep` test** that asserts a long query is cancelled, plus a clarifying comment.

## 9. Files changed / added

```
packages/@boringos/db/src/migrate.ts            brain__* schema + ensureBrainVectorTier (defensive pgvector)
packages/@boringos/brain/                        NEW package — the engine
  src/{types,capability,embedder,chunk,graph,retrieval,indexer,provider,index}.ts
packages/@boringos/core/src/modules/brain.ts     brain.* tools
packages/@boringos/core/src/modules/brain/SKILL.md
packages/@boringos/core/src/boringos.ts          default provider = brain; brain indexer → checkpoint
packages/@boringos/core/src/index.ts             export createBrainModule, createBrainMemory
packages/@boringos/agent/src/memory-checkpoint.ts  optional brainIndexer → post-run drive→brain mirror
packages/@boringos/drive/src/manager.ts          removed dead memory.remember(slice 2000) sync (decision #5)
scripts/dev-server.mjs                            register createBrainModule
scripts/verify-brain.mjs                          NEW — live HTTP verifier
tests/brain-engine.test.ts, tests/brain-integration.test.ts   NEW
tsconfig.json, vitest.config.ts, core/package.json   wire the new package
```

# BoringOS Brain — Canonical Plan

> The single source of truth for what the Brain is and how it's built. Companion to [`thesis.md`](thesis.md): the thesis says *why* Hebbs exists; this says *what the Brain is and exactly how we ship it*. One plan, no phases, no shortcuts. Re-read before touching any brain, memory, retrieval, or MCP code.

---

## 1. What the Brain is

A company's **foundation brain**: its books, its relationships, and its memory in one Postgres-backed store, exposed as a single thing any AI tool can **ask** — and, unlike a notes brain, can also **act** on.

One sentence, the pitch:

> **BoringOS Brain** = your company's exact data + semantic memory + entity graph in one Postgres brain, exposed as a single MCP any AI tool can `ask` — it returns a **cited** answer, tells you what it *doesn't* know, and can fire a tool or wake an agent on the answer.

The Brain is not a new product bolted on. It is the convergence of systems BoringOS already has — Drive, memory, entity links, the tool registry, copilot, Module schema — raised to a single coherent retrieval-and-synthesis surface, plus the two things genuinely missing: **a Postgres retrieval substrate** and **an MCP access plane**.

---

## 2. Decisions (settled — do not relitigate in code review)

1. **We own the Brain.** It is the moat; we do not rent it. Built native in `@boringos/brain`, in BoringOS's own embedded Postgres, multi-tenant from line one.
2. **Postgres is the brain store.** Embedded Postgres 18 (already booting) + `pgvector` + `pg_trgm`. Not a second database, not a sidecar, not RocksDB. The semantic tier lives in the *same* DB as the structured tier so `brain.ask` can join exact data to embeddings in one query.
   **Reality check (verified):** `embedded-postgres@18.1.0-beta.16` ships `pg_trgm` (contrib) but **not** `pgvector` — no `vector.control` in the binary package. We therefore ship **prebuilt pgvector artifacts per platform** (optional deps, mirroring the `@embedded-postgres/<platform>` pattern) and copy them into the embedded extension dir on boot before `CREATE EXTENSION vector`. If the platform artifact is missing, the semantic tier degrades to the FTS floor (§9) — boot never fails. External `DATABASE_URL` Postgres uses whatever pgvector it has. Note the embedded binary is a **beta** build; pin and track it deliberately.
3. **Files are the system of record; Postgres is the retrieval mirror.** Drive's markdown memory tree stays human-readable and canonical (git-friendly, portable). The Brain indexes it into Postgres on write; a file delete becomes a soft-delete in the mirror. (gbrain's proven model.)
4. **Embeddings: hosted BYOK is the default — OpenAI `text-embedding-3-small` at 768 dims.** `EMBEDDING_API_KEY` (+ optional `EMBEDDING_PROVIDER` for Voyage/Gemini) turns on the semantic tier; Postgres FTS is the floor without it, so boot never fails and keyless installs still answer. No local model in v1: BoringOS customers already hold API keys (agents are authenticated CLIs), so a local embedder's zero-key win was fiction, and its costs were real — ~600MB first-boot download, a native ONNX runtime dep, a second per-platform build matrix. A local ONNX rung stays on the ladder as a **future opt-in** for air-gapped/privacy-mandated self-hosters; the embedder interface + fixed 768 dims + lazy re-embed make adding it later a no-op for the schema.
5. **Hebbs memory provider is retired** — the Brain's `pgvector` provider replaces it as default. The old external Hebbs client is gone from the core surface. The retirement is **coupled, not separate**: the same change removes `DriveManager.write()`'s `memory.remember(slice 2000)` auto-sync, or every file double-ingests (§4.4).
6. **gbrain is the north star, not a dependency.** [garrytan/gbrain](https://github.com/garrytan/gbrain) (MIT) independently proved this exact shape in production (146k pages): files-as-SoR + pgvector mirror, hybrid retrieval, self-wiring typed graph, `search` vs `think`, 30+ tools over MCP. We borrow its *design* and match its *quality bar*; we ship a **gbrain opt-in provider** for customers already running it. We do not run its engine as our core (its one-brain-per-DB / login-scoped model fights BoringOS's single-process multi-tenancy, and it would never hold our operational tables).

7. **Brain schema ships in the global migrator, not `Module.schema`.** Module migrations run **per (tenant, module)** (`install-manager.ts:161-183`, tracked per `(tenantId, moduleId, migrationId)`) — a second tenant's install re-runs the same DDL against shared tables. The brain is a framework built-in, so `brain__*` tables + `CREATE EXTENSION` live in the core migrator (`db/src/migrate.ts` `_applySchema`), applied once globally. `Module.schema` stays the path for domain Modules (`ledger`, `ads`) — their DDL must be idempotent (`IF NOT EXISTS` everywhere) for exactly this reason.
8. **One embedding dimension: 768, forever.** Every rung of the ladder emits 768 dims — hosted providers via their dimension params (OpenAI `dimensions`, Voyage `output_dimension`, Gemini `outputDimensionality`); any future local model natively. Switching embedders never changes the column type, so per-row model-id drift + lazy re-embed actually works. No dim migration path exists because none is ever needed.
9. **`brain.query` safety: read-only role + statement timeout now; RLS deferred.** Capability first. v1 ships a dedicated read-only role and a statement timeout. Row-level-security policies on every `brain__*` and module table keyed to `current_setting('app.tenant_id')` remain the eventual tenancy mechanism — we will never parse or rewrite the caller's SQL — but they are **deferred until an MCP/REST token is exposed beyond localhost**. Every table keeps its `tenant_id` column from day one, so the deferral never becomes a migration.
10. **CLIs bring their own memory ability; the framework guides it.** Claude Code / Codex / pi can build their own memory given a filesystem — the drive mount + `MEMORY.md` + grep already gives substrate parity with what those CLIs do natively (the drive memory provider's `prime()` returns null *on purpose*: the agent reads its own index). What must ship alongside the brain is **guidance coverage**: a Memory & Drive section in every persona bundle and module-author guidance in BUILD-A-MODULE.md — today only the copilot persona is taught. The brain's own job is the part no CLI has natively: hybrid retrieval at corpus scale, exact SQL, the typed graph.
11. **Rows are indexed by reference, never copied.** Anything already in operational Postgres (`inbox_items`, comments, tasks, agent runs) joins the brain as a pointer row — `source_kind: 'row'`, `source_ref: '<table>:<id>'`, a short snippet for embedding/FTS — while the live row stays authoritative and `brain.query` reads it directly. A **core-schema SKILL** teaches the synthesis agent the operational tables. No double-storage, no staleness.
12. **Modules query each other.** Agent level: `brain.query` + every Module ships its schema as a SKILL (the `ledger`/`ads` convention, made universal). Code level: `ctx.callTool('<module>.<tool>', input)` on the module-sdk `ToolContext`, routed through the existing tool registry so Zod validation + `tool_calls` audit come for free. Modules stop being islands — today `ToolContext` exposes no memory, drive, or dispatch.

**Where we are bigger than gbrain:** gbrain is a *knowledge* brain. BoringOS Brain is an *operational, agentic* brain — it holds the ledger and ad spend, it's fed by live connectors and routines, and `brain.ask` can not only answer but **wake an agent to act**. gbrain has no agents.

---

## 3. Architecture

```
   Claude Cowork / Cursor / ChatGPT / Claude Code / your code / internal agents
                              │
              ┌───────────────┴────────────────┐
              │   Access plane                  │
              │   MCP server (stdio + HTTP)      │   scoped bearer / OAuth
              │   + existing REST /api/tools     │   connection profile = controls
              └───────────────┬────────────────┘
                              │  brain.ask · brain.search · brain.query · brain.graph · brain.remember
              ┌───────────────┴────────────────┐
              │   Synthesis  (brain.ask)         │   agent-driven, citation-required,
              │   = copilot elevated, grounded   │   gap-analysis-required
              └───────────────┬────────────────┘
        ┌──────────────┬──────┴───────┬──────────────┐
        ▼              ▼              ▼              ▼
   STRUCTURED      SEMANTIC        GRAPH          FILES
   exact SQL       hybrid          typed edges    Drive markdown
   ledger,         vector+FTS      multi-hop      = system of record
   ad_spend,       +RRF+rerank     auto-wired     indexed into ▲ on write
   metrics                         (zero-LLM)
        └──────────────┴──────────────┴──────────────┘
                     one embedded Postgres (tenantId-scoped)
                     embedder ladder: FTS floor → BYOK hosted (OpenAI 768) → local ONNX (future)
```

Five layers. Four are retrieval tiers over one Postgres; the fifth is the synthesis layer that answers across all of them.

---

## 4. The retrieval tiers

### 4.1 Structured tier — exact data, exact answers

Numbers never go through a vector. "What did we spend on Meta in May" is `SELECT SUM(...)`, auditable to the cent.

- **Storage:** Modules ship their own typed tables via the existing `Module.schema: Migration[]` path (tables prefixed `<id>__`, tracked per-tenant in `module_migrations`, with `up`/`down`). Verified at `packages/@boringos/agent/src/registries/install-manager.ts:161` and `module-sdk/src/types.ts:343`. Module DDL must be idempotent — migrations run per (tenant, module) against shared tables (decision #7).
- **Access:** each domain Module exposes typed read tools (`ledger.balance`, `ads.spend`) and ships its schema as a SKILL so the synthesizer knows the shape.
- **Reference Modules we ship at launch:** **`ledger`** (`ledger__transactions`, `ledger__accounts`) and **`ads`** (`ads__spend`, synced from Meta/Google via connector routines). These are the worked examples every future domain Module copies.
- **The operational core is already structured-tier data** (decision #11): `inbox_items` (emails!), comments, tasks, and agent runs are queryable via `brain.query` from day one. A **core-schema SKILL** ships describing these tables so the synthesizer knows emails and task history live in exact tables — never re-ingested into the semantic tier as copies.
- `brain.query` exposes scoped, read-only, tenant-filtered SQL for ad-hoc exact questions the typed tools don't cover.

### 4.2 Semantic tier — fuzzy recall over prose and episodic exhaust

- **Storage:** `brain__memories` (DDL in §6) with a `pgvector` embedding column **and** a `tsvector` FTS column. HNSW index for vector, GIN for FTS.
- **Retrieval is hybrid, not vector-alone** (gbrain's measured +31 P@5 over vector-only): vector cosine **+** BM25/FTS **+** reciprocal-rank fusion **+** optional reranker, blended with recency and importance. One SQL-driven path in the brain engine.
- **Chunking:** files and long memories are split heading-aware at ~1k tokens with ~150-token overlap; each chunk is its own `brain__memories` row (`source_ref` = path, `chunk_index` orders them). Citations point at chunks, so a cited claim resolves to the exact passage, not a whole file. Re-indexing a source replaces its chunks (soft-delete old rows by `source_ref`, insert new).
- **Fed by:** every agent run already produces comments, memory writes, task updates. A **distillation pass** turns that exhaust into clean, dense memory rows + fresh embeddings. The brain gets stronger every time an agent works — no separate curation step. This compounding is the product.
- **Distillation, concretely:** a post-run hook enqueues the run's exhaust; a per-tenant routine processes batches on the cheapest configured runtime (not per-run — bounded cost). Before insert, each candidate is similarity-checked against existing memories: above threshold → **reinforce** the existing row (`access_count++`, bump `importance`) instead of duplicating. That dedup path plus recall hits are the two writers of `access_count` — the reinforcement signal has a real write path, not just a column.
- **Row-backed sources are pointers, not copies** (decision #11): when the source already lives in an operational table (an inbox email, a comment), the indexer writes `source_kind: 'row'`, `source_ref: '<table>:<id>'`, and embeds only a representative snippet (subject + excerpt). Retrieval *finds* the row; `brain.ask` joins to the live table for the authoritative content. Distillation may *summarize across* rows into a new `distilled` memory, but never mirrors row content verbatim.

### 4.3 Graph tier — typed relationships, multi-hop

Today `entity_references` (`db/src/schema/entity-refs.ts`) is a generic untyped link table — CRUD + one-hop forward lookup, no typed edges, no traversal, no reverse API. We raise it to a real knowledge graph:

- **`brain__edges`** (DDL in §6): symmetric `(src_type, src_id, edge_type, dst_type, dst_id, weight, source_ref)` with semantic, directed, typed edges (`works_at`, `invested_in`, `founded`, `mentions`, `owns_deal`) and provenance back to the memory/file that created the edge.
- **Auto-wired on write, zero LLM** (gbrain's pattern): when a memory or file is written, extract `[[Entity]]` wikilinks and known-entity name mentions → upsert edges. No model call.
- **Name matching needs a name table.** "Known-entity mentions" requires canonical names + aliases — `entity_references` stores type/id pairs, not names. **`brain__entities`** (DDL in §6) holds `(entity_type, entity_id, name, aliases[])`; Modules register names (CRM registers contacts, ledger registers accounts) and wikilinks register on first sight. Mention-matching runs against this registry only.
- **Edge lifecycle, not just edge creation.** Edges are upserted against a unique key `(tenant_id, src_type, src_id, edge_type, dst_type, dst_id)` — re-indexing never duplicates. Re-indexing a source replaces its edges (soft-delete by `source_ref`, re-assert survivors); deleting a memory/file soft-deletes the edges it asserted. Edges carry `deleted_at` like memories do.
- **Traversal API + `brain.graph` tool:** reverse lookup, multi-hop ("who at Acme do we know → which deals → which invoices"), path-finding.
- An **edge-type registry** lets Modules declare the edges they own (CRM declares `owns_deal`, ledger declares `billed_to`).

### 4.4 Files tier — Drive as system of record

- Drive's per-tenant markdown memory tree (`users/<id>/memory/`, `shared/memory/`, `MEMORY.md`) stays canonical and human-editable.
- On write, the Brain indexes each file (markdown + YAML frontmatter: type, tags, dates) into the semantic + graph tiers. On file delete, the mirror row is soft-deleted (`deleted_at`), never hard-dropped — version history preserved.
- **The brain indexer is the only drive→memory path.** Today `DriveManager.write()` already auto-syncs text files into memory via `memory.remember(content.slice(0, 2000))` (`drive/src/manager.ts:78-86`) — naive truncation, and it would double-ingest every file once the brain also indexes on write. The brain indexer **replaces** that hook (proper chunking per §4.2); the old sync is removed in the same change that makes the brain the default provider, not "handled separately."
- This is the bridge that keeps "the brain is just a folder anyone can read" true while giving Postgres the retrieval power.

**Drive ergonomics (ships with the brain — the working surface must be legible):**

- **Slugged paths.** `tasks/<uuid>/` becomes `tasks/<id8>-<slug>/` (slug from the task title, **frozen at creation** so renames never move folders); same for `projects/`. Humans browsing Drive and agents reading their own workdir paths both get legible names; ACL/mount matching resolves on the id prefix, unchanged in spirit.
- **Curation is enforced, not hoped for.** Three mechanisms: (1) guidance in **all** persona bundles (decision #10), (2) the distillation routine (§4.2) as the systemic exhaust→memory path, (3) the scheduled **curator pass** (the lint job, §4.5). A **memory-hygiene eval** (§10) measures it.
- **Search posture.** Agents retrieve from their own memory tree the Claude Code way: read `MEMORY.md`, navigate, native grep on the mount — **never** via a search tool. `drive.search` (regex) survives only as the Shell/human search surface. `brain.search` (hybrid semantic) exists for the two consumers who can't grep: external MCP callers and corpora past curated-index scale. Since file chunks are mirrored into `brain__memories`, "embeddings only over Postgres rows" holds by construction.

### 4.5 The memory tree — file spec

> Sources this spec is checked against: Karpathy's LLM-wiki pattern (raw-sources / wiki / schema, index.md + log.md, lint), Parag's org-memory-for-OpenClaw architecture (knowledge *types* not topics, citations-per-fact, conflict surfacing, progressive compression), Lanham's markdown-memory-paradigm survey (files-first + derived semantic index = the converged equilibrium — exactly this plan's shape), and Thacker's 3-tier memory spec (daily → weekly → durable write order, read order on wake). The macro architecture needed no change; the tree below closes the taxonomy gaps.

The same shape at both scopes — `users/<id>/memory/` (per-human) and `shared/memory/` (tenant-canonical):

```
MEMORY.md               index + operational state; <200 lines; pointers, never content
10-domains/             canonical facts, one file per area; every fact ends with (src: ...)
20-decisions/           dated, who + why
30-people/              who does what, who to ask (lives mostly at shared scope)
40-operations/          learned procedures, runbooks, how-tos
60-daily/YYYY-MM-DD.md  append-only landing zone — run checkpoints + ambient observations
70-weekly/YYYY-WW.md    weekly synthesis — written by the distillation routine
99-archive/             superseded facts, never deleted
```

Numeric prefixes give deterministic sort = deterministic read priority. This **replaces** the v1 `decisions/ domains/ notes/ archive/` layout:

- **`notes/` dies.** `memory.remember` (tool path) appends to today's `60-daily/` note instead of spawning ISO-timestamped fragment files.
- **Per-session checkpoint files die.** The post-run checkpoint hook (`memory-checkpoint.ts`) appends to today's daily note under a `## [HH:MM] run <id8> (task <slug>)` header — "what happened yesterday" becomes one readable file, not N session files. Task working logs stay in `tasks/<id8>-<slug>/`.
- **Progressive compression is the spine** (the most-overlooked requirement): raw exhaust → daily → weekly synthesis → promoted to `10-domains/`/`20-decisions/` → superseded versions to `99-archive/`. The distillation routine (§4.2) writes `70-weekly/` and performs the promotion; nothing durable is born outside this pipeline except explicit user directives.

**Conventions (enforced by SKILL + curator lint):**

- **Citations per fact:** every promoted fact ends with a pointer — `(src: task:<id8>, 2026-06-12)`, `(src: inbox_items:<id>)`, `(src: [[acme-corp]])`. The brain indexer parses these into `source_ref`, so file-side and Postgres-side provenance are the same fact.
- **Conflict surfacing, not silent resolution:** contradictory facts get a `CONFLICT:` block quoting both sources, left visibly unresolved until a human or decision settles it. `brain.ask`'s contradiction eval (§10) reads these.
- **Wikilinks:** `[[entity]]` everywhere — already the graph tier's zero-LLM edge source (§4.3).
- **Write order:** explicit user directives ("remember", "from now on", "always") go **straight** to `20-decisions/` + a `MEMORY.md` pointer, before responding. Everything ambient lands in `60-daily/` and earns promotion at synthesis time.
- **Read order on wake:** `me/preferences.md` → `me/MEMORY.md` → `shared/MEMORY.md` → today's + yesterday's daily → current weekly → task log → grep on demand.
- **Size discipline:** ~200-line ceiling per file; the curator splits oversized files and fixes the pointers.
- **Curator pass = lint** (scheduled smart routine): contradictions, stale claims, orphan pages, missing cross-references, unpromoted daily content older than the synthesis window, `MEMORY.md` pointer drift, oversized files.

---

## 5. The synthesis layer — `brain.ask` ("answers everything")

The one verb external tools reach for. It does not return a ranked list — it returns **the answer, cited, with an explicit statement of what the brain doesn't know** (gbrain's `think`, not `search`).

**Built by elevating copilot, not replacing it.** Copilot already runs a per-tenant agent grounded by context providers (task, comments, `memory.prime`, hierarchy, guidelines) and is fully `tenantId`-scoped (`core/src/modules/copilot.ts`). We give that agent the brain's retrieval tools and a synthesis protocol:

- **Agentic routing, not a hardcoded router.** The synthesis agent is handed `brain.query` (exact SQL), `brain.search` (hybrid semantic), and `brain.graph` (traversal), plus the structured Modules' typed read tools, and orchestrates the retrieval itself — exact for numbers, semantic for prose, graph for relationships. BoringOS agents are CLIs; this is what they're good at.
- **Citations are mandatory and structured.** Every claim carries `{ source_kind: 'row'|'memory'|'file'|'edge', ref, value_or_quote }`. Numbers trace to a row; prose traces to a memory/file. Backed by the existing `work_products.record(kind:'citation', metadata)` hook (`framework.ts:478`) plus a typed citation block on the answer.
- **Gap analysis is mandatory.** The protocol requires the agent to state what it could not find ("no ad-spend data after May 30"). This is the differentiator and the trust mechanism.
- **It can act.** Because it runs in the BoringOS engine, the synthesis answer can include a proposed action that fires a tool or `framework.agents.wake` — gated by the connection profile (§8).

**The sync bridge (this is new — copilot alone doesn't deliver it).** Copilot's path is async: `start_session` creates a task, returns `{taskId}`, the answer lands later as a comment (`copilot.ts:106-189`). An MCP/REST `ask` needs the answer in the response. And the default queue is serial concurrency-1 (`pipeline/src/in-process.ts:17`) — an external ask must never queue behind a long agent run. So:

- `brain.ask` runs on a **dedicated synthesis lane** — its own in-process queue (default concurrency 2), separate from the agent-run queue. Asks don't block agents; agents don't block asks.
- The call is **spawn-and-wait**: the HTTP/MCP request holds until the synthesis run finalizes, default timeout 120s. On timeout (or `wait: false`), it returns a task handle `{taskId}` and falls back to the copilot async path — poll comments or SSE.
- Latency is real (a CLI agent run per question, seconds to a minute+). That's the cost of synthesis; callers who can't pay it use `brain.search`.

**Fast path:** `brain.search` returns raw hybrid retrieval (no agent, no synthesis) for tools that just want grounded chunks cheaply.

---

## 6. Data model

Cross-cutting `brain__*` tables live in the **core migrator** (decision #7), applied once globally; extensions enabled there too (pgvector artifact installed on boot per decision #2).

```sql
-- core migrator: extensions
CREATE EXTENSION IF NOT EXISTS vector;    -- skipped gracefully if artifact missing → FTS floor
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- semantic + files tiers
CREATE TABLE brain__memories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  entity_id    TEXT,                       -- optional subject (agent, contact, deal)
  source_kind  TEXT NOT NULL,              -- 'file' | 'row' | 'comment' | 'run' | 'manual' | 'distilled'
  source_ref   TEXT,                       -- drive path / '<table>:<id>' pointer / run id
  chunk_index  INTEGER NOT NULL DEFAULT 0, -- ordering within a chunked source (§4.2)
  kind         TEXT NOT NULL DEFAULT 'note',
  content      TEXT NOT NULL,
  embedding    vector(768),                -- 768 everywhere — decision #8
  embed_model  TEXT,                       -- model id per row; drift → lazy re-embed (same dim)
  fts          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  importance   REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0, -- written by recall hits + distillation dedup (§4.2)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ                 -- soft-delete; file deletes land here
);
CREATE INDEX brain__memories_vec_idx ON brain__memories
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX brain__memories_fts_idx ON brain__memories USING gin (fts);
CREATE INDEX brain__memories_tenant_idx ON brain__memories (tenant_id, deleted_at);
CREATE INDEX brain__memories_source_idx ON brain__memories (tenant_id, source_ref); -- replace-on-reindex

-- graph tier — typed, directed, provenance-tracked, upsert-keyed
CREATE TABLE brain__edges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  src_type   TEXT NOT NULL,
  src_id     TEXT NOT NULL,
  edge_type  TEXT NOT NULL,                -- 'works_at','invested_in','owns_deal',...
  dst_type   TEXT NOT NULL,
  dst_id     TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  source_ref TEXT,                         -- memory/file that asserted this edge
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ                   -- lifecycle follows the asserting source (§4.3)
);
CREATE UNIQUE INDEX brain__edges_key ON brain__edges
  (tenant_id, src_type, src_id, edge_type, dst_type, dst_id);   -- auto-wire upserts, never duplicates
CREATE INDEX brain__edges_dst_idx ON brain__edges (tenant_id, dst_type, dst_id); -- reverse lookup
CREATE INDEX brain__edges_type_idx ON brain__edges (tenant_id, edge_type);

-- entity name registry — mention-matching runs against this (§4.3)
CREATE TABLE brain__entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id)
);
CREATE INDEX brain__entities_name_idx ON brain__entities USING gin (name gin_trgm_ops);

-- access tokens (controls — §8)
CREATE TABLE brain__access_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,               -- store hash, never the token
  profile     JSONB NOT NULL,              -- connection profile (allowlist, scopes, gates, budget)
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Embedding dim is fixed at 768 (decision #8) so `embed_model` drift per row is recoverable by lazy re-embed without ever touching the column type. FTS config is `'english'` for v1 — multilingual is a known limit, noted, not solved.

---

## 7. The `brain.*` tool surface

All registered through the normal Module/tool path (`Tool` with Zod `inputs`, dispatched at `POST /api/tools/brain.<name>`, audited in `tool_calls`, tenant-scoped). All available to internal agents *and*, via the access plane, to external tools.

| Tool | Purpose |
|---|---|
| `brain.ask` | Synthesized, cited answer + gap analysis across all tiers (agentic). The headline verb. |
| `brain.search` | Raw hybrid retrieval (vector + FTS + RRF + rerank). Fast, no agent. |
| `brain.query` | Read-only SQL for exact structured questions — read-only role + statement timeout in v1; RLS lands with external exposure (decision #9). Never enforced by inspecting the query. |
| `brain.graph` | Typed multi-hop traversal / reverse lookup / path-finding. |
| `brain.remember` | Write a fact (also the `MemoryProvider.remember` path). |
| `brain.forget` | Soft-delete a memory. |
| `brain.approval_status` | Poll the resolution of a gated call that returned `pending_approval` (§8). |

The existing `memory.*` tools (`core/src/modules/memory.ts`) are re-pointed at the brain provider; `MemoryProvider` (`remember/recall/prime/forget/ping`) is implemented by the brain engine so the agent context pipeline (`memory-context.ts` → `memory.prime`) is grounded by hybrid retrieval with zero pipeline changes.

---

## 8. Access plane + controls

### MCP server — `@boringos/connector-mcp` (greenfield; no MCP code exists today)

A Module that mirrors the registry to MCP:
- **Tools:** enumerate `toolRegistry.list()`, convert each Zod schema to JSON Schema (the `toInputJsonSchema` converter already exists at `module-admin-routes.ts:25`), expose every `<module>.<tool>` — including `brain.*` — as an MCP tool. Calls proxy to the existing dispatch path, so audit + validation + tenant scoping come for free.
- **Resources:** memory entries and Drive files as MCP resources (read).
- **Prompts:** each Module's `SKILL.md` surfaced as MCP prompts — external tools get the same teaching internal agents get.
- **Transports:** stdio (local: Claude Code, Cursor, Cowork) and HTTP (remote). Auth via scoped bearer tokens (below); OAuth 2.1 optional for hosted.

REST `/api/tools/<module>.<tool>` is the same surface for code integrations — already built, already dual-mode auth.

### Controls — the connection profile

> **v1 scope (decision #9):** tenant binding, tool allowlist, audit, and revocation ship first — they're cheap and reuse existing machinery. Tier/namespace scoping, approval-gate depth, and RLS-backed enforcement land with the external-exposure milestone. Capability first.

Strong controls fall out of **one object per token**, stored in `brain__access_tokens.profile`, verified on every call with the existing JWT/bearer machinery (`tool-routes.ts` auth middleware):

- **Tool allowlist** — which `<module>.<tool>` this connection may call. Read-only by default; writes granted per tool (reuses the per-connector writes-gate pattern already in the framework).
- **Tier / source scope** — which tiers (structured/semantic/graph/files) and which Drive sources this connection can see. *Access control is "which files/tiers do you get" — no separate gateway policy engine.*
- **Memory namespace** — the slice of memory visible (e.g. `sales`, not `hr`).
- **Approval gates** — high-risk tools (send, pay, delete, wake-agent) don't execute on an external call; they land as a pending approval surfaced in Shell (the approval context already exists in the context pipeline). Human approves → it runs. This is the killer control: an outside AI can *propose* anything, *commit* nothing unsupervised. **Wire contract:** MCP/REST calls are synchronous, so a gated call returns `{ status: 'pending_approval', approvalId }` immediately; the caller polls `brain.approval_status` (or subscribes via SSE) for the resolution. The external tool is told this in the MCP tool description so it knows to wait, not retry.
- **Budget + rate limit** — external calls consume budget and are rate-limited per token. Usage is **computed from `tool_calls` rows** stamped with the token identity — the audit trail is the counter store; no separate usage table.
- **Tenant binding** — every token maps to exactly one tenant. stdio transport binds via the token in the MCP server's env; HTTP via the bearer. There is no tenant parameter on any call — tenancy is never caller-supplied.
- **Audit + provenance** — every external dispatch writes a `tool_calls` row stamped with the external identity (`invokedBy`). Full who/where/what/approved-by trail.
- **Revocable, time-boxed** — `expires_at` / `revoked_at`; rotate instantly.

---

## 9. Embeddings — the ladder

| Mode | Embedder | When |
|---|---|---|
| **Floor** | none — Postgres FTS (BM25) only | no key; still boots, still answers |
| **Default** | BYOK hosted: **OpenAI `text-embedding-3-small`** via `EMBEDDING_API_KEY`; Voyage / Gemini via `EMBEDDING_PROVIDER` | the v1 semantic tier — customers already hold keys (agent CLIs require them); cost is noise (~$0.02/1M tokens) |
| **Future opt-in** | local in-process ONNX (`embedding-gemma-300m`-class) | air-gapped / privacy-mandated self-hosters; not built in v1 |

Every rung emits **768 dims** (decision #8): hosted providers via their dimension params (OpenAI `dimensions: 768`, Voyage `output_dimension`, Gemini `outputDimensionality`); a future local model natively. Flipping creds changes quality, never schema.

Optional reranker on the same ladder (none → hosted; local cross-encoder if/when the local rung lands). One embedder interface in `@boringos/brain`; flipping creds upgrades quality without touching anything downstream. The FTS floor also covers the embedded-Postgres-without-pgvector case (decision #2), not just the no-key case.

---

## 10. Quality bar — the launch gate

The Brain ships only when it passes an eval harness (gbrain ships four; we match the spirit):

- **Retrieval quality** — named-thing / known-fact retrieval regression suite over a seeded corpus; hybrid must beat vector-only and FTS-only baselines.
- **Answer quality** — `brain.ask` answers are graded for correctness **and** citation validity (every claim resolves to a real row/memory/file).
- **Exactness** — structured questions ("May Meta spend") must be correct to the cent and never answered from the semantic tier.
- **Contradiction / gap** — cross-source contradiction detection and honest gap-analysis on questions with no answer in the brain.
- **Memory hygiene** — after a seeded set of runs containing durable facts (a user preference, a decision, a learned constraint), assert the facts landed in `decisions/`/`domains/` with fresh `MEMORY.md` pointers — measuring that agents *save well*, not just retrieve well.
- **Multi-tenancy** — fuzz that no token ever reads another tenant's row, edge, file, or memory. *Gates the external-exposure milestone (decision #9), not the internal v1 launch.*

---

## 11. What we reuse vs build (grounded)

| Brain piece | Reuse (exists) | Build (new) |
|---|---|---|
| Brain store | embedded Postgres 18, custom migrator (`db/src/migrate.ts`), `Module.schema` path (`install-manager.ts:161`) | per-platform pgvector artifacts + boot install, `vector`/`pg_trgm` extensions, `brain__*` tables in the core migrator, RLS policies for `brain.query` |
| Memory seam | `MemoryProvider` iface, `memory.*` tools, `memory-context.ts` pipeline injection | `pgvector` provider implementing it; becomes default |
| Semantic tier | — | `@boringos/brain` hybrid retrieval (vector+FTS+RRF+rerank) + embedder ladder |
| Structured tier | `Module.schema`, typed tools, SKILL convention | `ledger` + `ads` reference Modules |
| Graph tier | `entity_references` (untyped, one-hop forward, no reverse API) | `brain__edges` (typed, multi-hop, upsert-keyed, lifecycle-tracked), `brain__entities` name registry, traversal API, `brain.graph` |
| Files tier | Drive memory tree, drive module | index-on-write + soft-delete sync into Postgres; memory-tree v2 migration (§4.5: numbered type folders, daily/weekly tiers, citations, conflicts) — touches `memory/src/drive.ts` paths, scaffolds, checkpoint destinations, memory SKILL.md |
| Synthesis | copilot agent + context providers + `work_products` citation hook, full `tenantId` scoping | `brain.ask` protocol (mandatory citations + gap analysis), retrieval tools wired to the agent, sync spawn-and-wait bridge + dedicated synthesis lane (§5) |
| Tool surface | tool registry, `POST /api/tools`, Zod→JSON Schema converter, dual-mode auth, `tool_calls` audit | `brain.*` tools |
| Access plane | REST tool surface, JWT/bearer auth | `@boringos/connector-mcp` (stdio+HTTP), MCP resources/prompts |
| Controls | callback-JWT machinery, approval context, writes-gate, budget, audit | `brain__access_tokens` + connection-profile enforcement |
| Interop | — | gbrain opt-in `MemoryProvider` (for customers already on gbrain) |
| Module interop | tool registry, dispatch path, `tool_calls` audit | `ctx.callTool` on module-sdk `ToolContext`; schema-as-SKILL convention extended to every Module (decision #12) |
| Guidance | memory + drive SKILL.md, copilot SOUL.md | Memory & Drive section in all persona bundles; module-author guidance + reference example in BUILD-A-MODULE.md; core-schema SKILL for operational tables (decisions #10, #11) |

---

## 12. Packages & modules (the complete inventory)

- **The brain strategy doc, published on GitHub — first deliverable, before code.** A public-facing write-up of the brain strategy (what it is, the four tiers, the memory tree, the MCP access plane, why files-as-SoR + Postgres mirror, why we own it) lands in the repo docs and on docs.hebbs.ai (GitHub Pages is already wired). Derived from this plan + `thesis.md`; this internal plan stays canonical, the public doc tracks it. Note: `docs/brain.md` itself is currently untracked — commit it as part of this.
- **`@boringos/brain`** (new package) — the owned engine: embedder ladder, hybrid retrieval, graph traversal, distillation. Postgres-native, `tenantId`-scoped. The moat.
- **`brain` module** (in core) — owns `brain__*` schema + the `brain.*` tools + the `pgvector` `MemoryProvider` + brain SKILL.md.
- **`@boringos/connector-mcp`** (new module) — the MCP access plane.
- **`ledger` module**, **`ads` module** (new) — the first structured-domain reference Modules.
- **gbrain opt-in provider** — a `MemoryProvider` proxying to an external gbrain instance, for the interop path. Optional, not default.

---

## 13. Non-goals / explicit risks

- **Not a second datastore.** If a design step introduces RocksDB, a separate vector DB, or a per-tenant sidecar, it's wrong — the whole win is one Postgres.
- **No silent vector answers to exact questions.** Money/metrics route to SQL or the answer is rejected. Hardcode this in the synthesis protocol and assert it in evals.
- **Embedder model drift.** Dim is fixed at 768 (decision #8) so switching embedders never changes schema — but mixed-model rows in one index degrade recall. The engine detects `embed_model` drift per row and re-embeds lazily; ship the re-embed job with v1, not after.
- **pgvector packaging.** The embedded distro doesn't ship pgvector (verified); we own prebuilt per-platform artifacts (decision #2). That's a build matrix to maintain across embedded-postgres upgrades — and the upstream binary is currently a beta. Pin both deliberately; FTS floor means a missing artifact degrades, never breaks.
- **Hosted-embedder privacy.** Every embedded chunk (memories, email snippets, file contents) transits the embedding provider. Acceptable for v1; the local ONNX rung (§9, future opt-in) is the answer for air-gapped/privacy-mandated customers — keep the embedder interface clean so it slots in without schema or engine changes.
- **`brain.ask` latency + lane starvation.** Each ask is a CLI agent run (seconds to a minute+). The synthesis lane (§5) keeps asks off the agent queue, but concurrency on that lane is still a subprocess each — keep its default low (2) and let `brain.search` absorb the cheap traffic.
- **gbrain coupling.** The opt-in provider tracks gbrain's external API, which moves fast. It's optional and isolated behind `MemoryProvider`; never let it into the core path.
- **Graph auto-wiring precision.** Mention-matching creates noisy edges. Weight by match confidence, keep provenance (`source_ref`) so bad edges are traceable and prunable; do not let the graph tier degrade `brain.ask` precision.

---

## 14. The launch claim

When this is done, a customer:
1. Installs BoringOS — Postgres brain boots on the FTS floor; pasting the OpenAI key they already have (agents need one anyway) turns on full semantic recall.
2. Their agents work; the brain fills itself from the exhaust.
3. They add `ledger`/`ads`/CRM Modules — exact data joins the brain.
4. They connect Claude Cowork / Cursor / their code over MCP with a scoped token.
5. They `ask` the brain anything — and get a **cited answer across their books, relationships, and memory, with an honest account of what it doesn't know, and the option to act on it.**

One brain. One Postgres. One `ask`. Owned, not rented.

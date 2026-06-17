// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `brain` Module — the brain.* tool surface (docs/brain.md §7).
//
// Five tiers, one synthesis verb, all dispatched through the normal
// tool path (Zod-validated, tool_calls-audited, tenant-scoped):
//
//   brain.ask     — synthesized, cited answer + gap analysis (agentic,
//                   spawn-and-wait on the copilot synthesis lane).
//   brain.search  — raw hybrid retrieval (vector+FTS+RRF). Fast.
//   brain.query   — read-only SQL for exact structured questions.
//   brain.graph   — typed multi-hop traversal / reverse lookup.
//   brain.remember/forget — write/soft-delete a fact (MemoryProvider).
//   brain.approval_status — poll a gated call's resolution (§8).
//
// The brain SHARES the framework's MemoryProvider: when the host runs
// the brain provider as default (boringos.ts), `memory.*` and
// `brain.remember` write the same rows. The module owns the read-side
// surfaces the bare MemoryProvider interface doesn't expose (SQL,
// graph, synthesis).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { tasks, taskComments, agents as agentsTable } from "@boringos/db";
import { generateId } from "@boringos/shared";
import {
  searchHybrid,
  reinforce,
  createGraphReader,
  createIndexer,
  distill,
  curate,
  exportOkf,
  materializeSchemaDocs,
  ingestRows,
  CORE_OPERATIONAL_SCHEMA,
  probeCapabilities,
  resolveEmbedder,
} from "@boringos/brain";
import type { Embedder } from "@boringos/brain";
import type { MemoryProvider } from "@boringos/memory";
import type { StorageBackend } from "@boringos/drive";
import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleContext,
  ModuleFactory,
  ModuleLifecycle,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";

const BRAIN_SKILL = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "brain", "SKILL.md"), "utf8");
  } catch {
    return "# Brain\n\nUse brain.ask / brain.search / brain.query / brain.graph to retrieve across the company's books, relationships, and memory.";
  }
})();

/** Minimal engine surface brain.ask needs — avoids importing the full type. */
interface EngineLike {
  wake(req: {
    agentId: string;
    tenantId: string;
    taskId?: string;
    reason: "manual_request";
  }): Promise<{ kind: string; wakeupRequestId?: string }>;
  enqueue(wakeupId: string): Promise<string>;
}

const DISTILL_WORKFLOW_NAME = "Brain weekly distillation";
const DISTILL_ROUTINE_TITLE = "Weekly memory distillation";
const CURATE_WORKFLOW_NAME = "Brain daily curation";
const CURATE_ROUTINE_TITLE = "Daily memory curation";
const INGEST_WORKFLOW_NAME = "Brain operational ingest";
const INGEST_ROUTINE_TITLE = "Hourly operational ingest";

export const createBrainModule: ModuleFactory = (deps) => {
  const db = deps.db as Db;
  const memory = deps.memory as MemoryProvider | undefined;
  const drive = deps.drive as StorageBackend | undefined;
  const embedder: Embedder = resolveEmbedder();
  const graph = createGraphReader(db);

  // ── brain.search ──────────────────────────────────────────────────
  const searchTool: Tool = {
    name: "search",
    description:
      "Hybrid semantic + keyword retrieval over the brain's memory tier (vector + FTS + reciprocal-rank fusion). Returns grounded chunks with their source. Fast — no synthesis. Use brain.ask when you want a written answer.",
    inputs: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
      scope: z.enum(["tenant", "user"]).optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: { query: string; limit?: number; scope?: "tenant" | "user"; entityId?: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const caps = await probeCapabilities(db);
      const hits = await searchHybrid(db, embedder, caps.hasVector, {
        tenantId: ctx.tenantId,
        query: input.query,
        limit: input.limit ?? 10,
        scope: input.scope,
        ownerUserId: ctx.wakeOwnerUserId,
        entityId: input.entityId,
      });
      void reinforce(db, hits.map((h) => h.id));
      return {
        ok: true,
        result: {
          tier: caps.hasVector ? "semantic (vector+FTS)" : "fts-floor",
          results: hits.map((h) => ({
            content: h.content,
            sourceKind: h.sourceKind,
            sourceRef: h.sourceRef,
            chunkIndex: h.chunkIndex,
            score: Number(h.score.toFixed(4)),
            matched: h.matched,
          })),
        },
      };
    },
  };

  // ── brain.query ───────────────────────────────────────────────────
  const queryTool: Tool = {
    name: "query",
    description:
      "Run a READ-ONLY SQL query for exact structured questions (numbers, counts, dates). Executes inside a read-only transaction with a statement timeout — writes/DDL are rejected by Postgres. Always filter by tenant_id; the brain does not scope your SQL for you. Operational tables: inbox_items, tasks, task_comments, agent_runs; module tables: <module>__* (e.g. crm__deals, ledger__transactions).",
    inputs: z.object({
      sql: z.string().min(1),
      maxRows: z.number().int().positive().max(5000).optional(),
    }),
    async handler(input: { sql: string; maxRows?: number }, _ctx: ToolContext): Promise<ToolResult> {
      const maxRows = input.maxRows ?? 500;
      try {
        const rows = await db.transaction(async (tx) => {
          // Read-only + timeout (decision #9). Postgres enforces both at
          // the engine level — we never parse the query. SET LOCAL scopes
          // the timeout to the REMAINDER of this transaction (Postgres
          // semantics: it lasts until COMMIT/ROLLBACK, so it covers the
          // user query below — verified by the pg_sleep test in
          // tests/brain-integration.test.ts). SET TRANSACTION READ ONLY
          // rejects any write/DDL with a "read-only transaction" error.
          await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
          await tx.execute(sql.raw("SET LOCAL statement_timeout = '8000ms'"));
          const result = await tx.execute(sql.raw(input.sql));
          return result as unknown as unknown[];
        });
        const arr = Array.isArray(rows) ? rows : [];
        const truncated = arr.length > maxRows;
        return {
          ok: true,
          result: {
            rowCount: arr.length,
            truncated,
            rows: truncated ? arr.slice(0, maxRows) : arr,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Read-only violations + syntax errors are expected business
        // errors the agent should reason about — not internal crashes.
        return {
          ok: false,
          error: {
            code: message.toLowerCase().includes("read-only") ? "permission_denied" : "invalid_input",
            message,
            retryable: false,
          },
        };
      }
    },
  };

  // ── brain.graph ───────────────────────────────────────────────────
  const graphTool: Tool = {
    name: "graph",
    description:
      "Traverse the typed entity graph — reverse lookup, multi-hop ('who at Acme → which deals → which invoices'), relationship discovery. Edges are auto-wired from [[wikilinks]] and module-registered entities. Start from a node (type+id) and walk outward.",
    inputs: z.object({
      type: z.string(),
      id: z.string(),
      direction: z.enum(["out", "in", "both"]).optional(),
      edgeType: z.string().optional(),
      depth: z.number().int().positive().max(5).optional(),
    }),
    async handler(
      input: {
        type: string;
        id: string;
        direction?: "out" | "in" | "both";
        edgeType?: string;
        depth?: number;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const result = await graph.traverse({
        tenantId: ctx.tenantId,
        type: input.type,
        id: input.id,
        direction: input.direction,
        edgeType: input.edgeType,
        depth: input.depth,
      });
      return { ok: true, result };
    },
  };

  // ── brain.remember ────────────────────────────────────────────────
  const rememberTool: Tool = {
    name: "remember",
    description:
      "Save a durable fact to the brain. Writes the canonical markdown file (system of record) AND indexes it for hybrid recall + graph wiring. Default scope follows the wake's human context; pass scope:'tenant' to promote to tenant-canonical truth.",
    inputs: z.object({
      content: z.string(),
      scope: z.enum(["user", "tenant"]).optional(),
      importance: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional(),
      entityId: z.string().optional(),
    }),
    async handler(
      input: {
        content: string;
        scope?: "user" | "tenant";
        importance?: number;
        tags?: string[];
        entityId?: string;
      },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!memory) {
        return notConfigured();
      }
      const scope = input.scope ?? (ctx.wakeOwnerUserId ? "user" : "tenant");
      if (scope === "user" && !ctx.wakeOwnerUserId) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message:
              "Cannot write user-scope memory without a wake owner. Use scope:'tenant' or invoke from a user-initiated wake.",
            retryable: false,
          },
        };
      }
      const id = await memory.remember(input.content, {
        tenantId: ctx.tenantId,
        scope,
        ownerUserId: ctx.wakeOwnerUserId,
        entityId: input.entityId,
        tags: input.tags,
        importance: input.importance,
      });
      return { ok: true, result: { memoryId: id, scope } };
    },
  };

  // ── brain.forget ──────────────────────────────────────────────────
  const forgetTool: Tool = {
    name: "forget",
    description:
      "Soft-delete a memory by id (the path brain.remember returned). The file is removed and the brain mirror + its graph edges are soft-deleted (version history preserved).",
    inputs: z.object({ memoryId: z.string() }),
    async handler(input: { memoryId: string }, ctx: ToolContext): Promise<ToolResult> {
      if (!memory) return notConfigured();
      const fullPath = `${ctx.tenantId}/${input.memoryId}`;
      await memory.forget(fullPath);
      return { ok: true, result: { ok: true } };
    },
  };

  // ── brain.ask ─────────────────────────────────────────────────────
  const askTool: Tool = {
    name: "ask",
    description:
      "Ask the brain a question in natural language. Returns a synthesized, cited answer across every tier (exact data, semantic memory, the graph) plus an honest statement of what the brain could NOT find. Spawns a synthesis run on the copilot — slower than brain.search (seconds to a minute). Pass wait:false to get a task handle immediately and poll the task's comments.",
    inputs: z.object({
      question: z.string().min(1),
      wait: z.boolean().optional(),
      timeoutMs: z.number().int().positive().max(300000).optional(),
    }),
    async handler(
      input: { question: string; wait?: boolean; timeoutMs?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const wait = input.wait ?? true;
      const timeoutMs = input.timeoutMs ?? 120_000;

      // Pre-fetch grounding context so the synthesis agent (and the
      // fast-path fallback) start from real retrieval, not a cold prompt.
      const caps = await probeCapabilities(db);
      const hits = await searchHybrid(db, embedder, caps.hasVector, {
        tenantId: ctx.tenantId,
        query: input.question,
        limit: 8,
        ownerUserId: ctx.wakeOwnerUserId,
      });
      const citations = hits.map((h, i) => ({
        n: i + 1,
        sourceKind: h.sourceKind,
        ref: h.sourceRef,
        quote: h.content.slice(0, 280),
      }));

      const engine = deps.engine as EngineLike | undefined;

      // Find the tenant's copilot — the synthesis agent (§5: brain.ask
      // = copilot elevated, grounded). No copilot / no engine → return
      // the raw grounded chunks so the caller still gets something
      // useful instead of an error (FTS-floor / no-runtime degrade).
      const copilotRows = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.tenantId, ctx.tenantId), eq(agentsTable.role, "copilot")))
        .limit(1);
      const copilotId = copilotRows[0]?.id;

      if (!engine || !copilotId) {
        return {
          ok: true,
          result: {
            synthesized: false,
            answer:
              "Synthesis is unavailable (no copilot agent or engine wired). Returning grounded retrieval instead.",
            citations,
            gaps: ["brain.ask synthesis not available — answer is raw retrieval, not reasoned across tiers."],
          },
        };
      }

      // Create the synthesis task seeded with the question + grounding +
      // the synthesis protocol. originKind 'brain.ask' so the run is
      // attributable; the copilot persona + brain SKILL teach the rules.
      const taskId = generateId();
      const contextBlock =
        citations.length > 0
          ? citations
              .map((c) => `[${c.n}] (${c.sourceKind} ${c.ref ?? "—"}) ${c.quote}`)
              .join("\n")
          : "(no semantic matches — rely on brain.query / brain.graph)";

      const description = [
        `# brain.ask synthesis`,
        ``,
        `## Question`,
        input.question,
        ``,
        `## Pre-fetched grounding (semantic tier)`,
        contextBlock,
        ``,
        `## Your job`,
        `Answer the question by orchestrating brain.query (exact SQL for numbers),`,
        `brain.search (more semantic context), and brain.graph (relationships).`,
        ``,
        `Live operational data: the \`type: table\` docs under \`50-schema/\` are the`,
        `column-level catalog — read the relevant one (it's in the grounding or via`,
        `brain.search "<table> schema") to learn exact column names, THEN write`,
        `column-accurate brain.query SQL (always filter by tenant_id). Grounding`,
        `hits with sourceKind 'row' are pointers to live rows (ref '<table>:<id>',`,
        `e.g. inbox_items:<id>) — join to the row via brain.query for authoritative`,
        `content and cite that row.`,
        ``,
        `MANDATORY: cite every claim to a row/memory/file/edge; route all numbers`,
        `to brain.query (never a vector); and END with a "Gaps:" section stating`,
        `what you could not find. Propose actions as agent_action tasks — never`,
        `execute side effects inside the answer.`,
      ].join("\n");

      // Stamp the cutoff BEFORE creating/waking the task so a reply
      // that lands in the window between task-create and the first poll
      // is still seen (otherwise a fast synthesis run could be missed).
      const askStartedAt = new Date();

      await db.insert(tasks).values({
        id: taskId,
        tenantId: ctx.tenantId,
        title: `Ask: ${input.question.slice(0, 60)}`,
        description,
        status: "todo",
        priority: "high",
        assigneeAgentId: copilotId,
        createdByAgentId: ctx.agentId,
        originKind: "brain.ask",
      });

      const outcome = await engine.wake({
        agentId: copilotId,
        tenantId: ctx.tenantId,
        taskId,
        reason: "manual_request",
      });
      if (outcome.kind === "created" && outcome.wakeupRequestId) {
        await engine.enqueue(outcome.wakeupRequestId);
      }

      if (!wait) {
        return {
          ok: true,
          result: { synthesized: false, status: "pending", taskId, citations },
        };
      }

      // Spawn-and-wait: poll the task's comments for the AGENT's reply
      // (the engine auto-posts the run result as a comment authored by
      // the copilot). On timeout, hand back the task id for async poll.
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(1500);
        // Filter on author_agent_id = copilot so a human comment posted
        // on the task before synthesis finishes can't be mistaken for
        // the answer; and on created_at > askStartedAt so we only see
        // comments from this ask.
        const reply = await db
          .select({ body: taskComments.body, createdAt: taskComments.createdAt })
          .from(taskComments)
          .where(
            and(
              eq(taskComments.taskId, taskId),
              eq(taskComments.tenantId, ctx.tenantId),
              eq(taskComments.authorAgentId, copilotId),
              gt(taskComments.createdAt, askStartedAt),
            ),
          )
          .orderBy(desc(taskComments.createdAt))
          .limit(1);
        if (reply[0]?.body) {
          return {
            ok: true,
            result: {
              synthesized: true,
              answer: reply[0].body,
              citations,
              taskId,
            },
          };
        }
      }

      return {
        ok: true,
        result: {
          synthesized: false,
          status: "pending",
          taskId,
          citations,
          note: `Synthesis exceeded ${timeoutMs}ms — poll comments on task ${taskId} or subscribe via SSE.`,
        },
      };
    },
  };

  // ── brain.approval_status ─────────────────────────────────────────
  const approvalStatusTool: Tool = {
    name: "approval_status",
    description:
      "Poll the resolution of a gated call that returned pending_approval (§8). Returns the approval task's status and decision. v1 reads the approval-as-task model (agent_action tasks).",
    inputs: z.object({ approvalId: z.string() }),
    async handler(input: { approvalId: string }, ctx: ToolContext): Promise<ToolResult> {
      const rows = await db
        .select({
          status: tasks.status,
          metadata: tasks.metadata,
          nextActor: tasks.nextActor,
        })
        .from(tasks)
        .where(and(eq(tasks.id, input.approvalId), eq(tasks.tenantId, ctx.tenantId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return {
          ok: false,
          error: { code: "not_found", message: `No approval ${input.approvalId}`, retryable: false },
        };
      }
      const approval = (row.metadata as { approval?: { decision?: string } } | null)?.approval;
      const resolved = row.status === "done" || row.status === "cancelled" || !!approval?.decision;
      return {
        ok: true,
        result: {
          approvalId: input.approvalId,
          status: resolved ? "resolved" : "pending",
          decision: approval?.decision ?? null,
          taskStatus: row.status,
        },
      };
    },
  };

  // ── brain.distill ─────────────────────────────────────────────────
  const distillTool: Tool = {
    name: "distill",
    description:
      "Run the distillation pass for this tenant (docs/brain.md §4.2/§4.5): dedup-reinforce daily memory, promote durable facts into 10-domains/20-decisions (+ MEMORY.md pointers), retire superseded versions to 99-archive, and write the weekly synthesis. Deterministic + idempotent. Normally fired by the weekly routine; callable manually to compress on demand.",
    inputs: z.object({
      scope: z.enum(["tenant", "user"]).optional(),
      windowDays: z.number().int().positive().max(90).optional(),
    }),
    async handler(
      input: { scope?: "tenant" | "user"; windowDays?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!drive) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Drive backend not configured", retryable: false },
        };
      }
      const scope = input.scope ?? "tenant";
      const ownerUserId = scope === "user" ? ctx.wakeOwnerUserId : undefined;
      if (scope === "user" && !ownerUserId) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "user-scope distillation requires a wake owner", retryable: false },
        };
      }
      const caps = await probeCapabilities(db);
      const indexer = createIndexer({ db, embedder, hasVector: caps.hasVector });
      const result = await distill(
        { db, drive, indexer },
        { tenantId: ctx.tenantId, scope, ownerUserId, now: new Date(), windowDays: input.windowDays },
      );
      return { ok: true, result };
    },
  };

  // ── brain.curate ──────────────────────────────────────────────────
  const curateTool: Tool = {
    name: "curate",
    description:
      "Run the curator/lint pass for this tenant (docs/brain.md §4.5): split oversized files (>200 lines) and repoint MEMORY.md, surface contradictions as CONFLICT: blocks (never auto-resolved), add pointers for orphan pages, remove broken pointers, and flag promoted facts missing a (src:) citation + stale unpromoted daily content. Deterministic + idempotent. Normally fired by the daily routine; returns a lint report.",
    inputs: z.object({
      scope: z.enum(["tenant", "user"]).optional(),
      maxLines: z.number().int().positive().max(5000).optional(),
      staleDays: z.number().int().positive().max(365).optional(),
    }),
    async handler(
      input: { scope?: "tenant" | "user"; maxLines?: number; staleDays?: number },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!drive) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Drive backend not configured", retryable: false },
        };
      }
      const scope = input.scope ?? "tenant";
      const ownerUserId = scope === "user" ? ctx.wakeOwnerUserId : undefined;
      if (scope === "user" && !ownerUserId) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "user-scope curation requires a wake owner", retryable: false },
        };
      }
      const caps = await probeCapabilities(db);
      const indexer = createIndexer({ db, embedder, hasVector: caps.hasVector });
      const report = await curate(
        { db, drive, indexer },
        {
          tenantId: ctx.tenantId,
          scope,
          ownerUserId,
          now: new Date(),
          maxLines: input.maxLines,
          staleDays: input.staleDays,
        },
      );
      return { ok: true, result: report };
    },
  };

  // ── brain.export_okf ──────────────────────────────────────────────
  const exportOkfTool: Tool = {
    name: "export_okf",
    description:
      "Export this tenant's memory tree as an OKF (Open Knowledge Format) bundle (docs/brain-okf-compat.md): ensures the tree is curated (frontmatter + per-dir index.md + okf_version), validates OKF §9 conformance over the whole bundle, and writes a bundle-level log.md from the weekly syntheses. Returns a manifest { bundleRoot, fileCount, conformant, okfVersion, violations }. The tree IS the bundle — portable to any OKF consumer (Obsidian/Notion/MkDocs/Dataplex/graph viewers).",
    inputs: z.object({
      scope: z.enum(["tenant", "user"]).optional(),
      writeLog: z.boolean().optional(),
    }),
    async handler(
      input: { scope?: "tenant" | "user"; writeLog?: boolean },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      if (!drive) {
        return {
          ok: false,
          error: { code: "upstream_unavailable", message: "Drive backend not configured", retryable: false },
        };
      }
      const scope = input.scope ?? "tenant";
      const ownerUserId = scope === "user" ? ctx.wakeOwnerUserId : undefined;
      if (scope === "user" && !ownerUserId) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "user-scope export requires a wake owner", retryable: false },
        };
      }
      const caps = await probeCapabilities(db);
      const indexer = createIndexer({ db, embedder, hasVector: caps.hasVector });
      const result = await exportOkf(
        { db, drive, indexer },
        { tenantId: ctx.tenantId, scope, ownerUserId, now: new Date(), writeLog: input.writeLog },
      );
      return { ok: true, result };
    },
  };

  // ── brain.sync_schema ─────────────────────────────────────────────
  const syncSchemaTool: Tool = {
    name: "sync_schema",
    description:
      "Materialize the OKF schema catalog (docs/brain-okf-compat.md): one `type: table` concept doc per operational + module table — columns read from the LIVE database, written into 50-schema/ and indexed — so brain.search/brain.ask know your tables and brain.query can be column-accurate. Idempotent.",
    inputs: z.object({ scope: z.enum(["tenant", "user"]).optional() }),
    async handler(input: { scope?: "tenant" | "user" }, ctx: ToolContext): Promise<ToolResult> {
      if (!drive) return notConfigured();
      const scope = input.scope ?? "tenant";
      const ownerUserId = scope === "user" ? ctx.wakeOwnerUserId : undefined;
      if (scope === "user" && !ownerUserId) {
        return { ok: false, error: { code: "invalid_input", message: "user-scope requires a wake owner", retryable: false } };
      }
      const caps = await probeCapabilities(db);
      const indexer = createIndexer({ db, embedder, hasVector: caps.hasVector });
      const enrich: Record<string, { table: string; description?: string; columns?: Array<{ name: string; description?: string }> }> = {};
      for (const t of CORE_OPERATIONAL_SCHEMA) enrich[t.table] = t;
      const result = await materializeSchemaDocs({ db, drive, indexer }, { tenantId: ctx.tenantId, scope, ownerUserId, now: new Date(), enrich });
      return { ok: true, result };
    },
  };

  // ── brain.ingest_rows ─────────────────────────────────────────────
  const ingestRowsTool: Tool = {
    name: "ingest_rows",
    description:
      "Index recent rows of operational + module tables (inbox emails, tasks, comments, runs, <module>__* tables) as brain ROW POINTERS — snippet-only, by reference, never a copy (decision #11) — so brain.search/brain.ask can find live data and cite it back to the row. Idempotent; tenant-scoped.",
    inputs: z.object({ limit: z.number().int().positive().max(2000).optional() }),
    async handler(input: { limit?: number }, ctx: ToolContext): Promise<ToolResult> {
      if (!drive) return notConfigured();
      const caps = await probeCapabilities(db);
      const indexer = createIndexer({ db, embedder, hasVector: caps.hasVector });
      const result = await ingestRows({ db, drive, indexer }, { tenantId: ctx.tenantId, now: new Date(), limit: input.limit });
      return { ok: true, result };
    },
  };

  const module: Module = {
    id: "brain",
    name: "Brain",
    version: "0.1.0",
    description:
      "Your company's foundation brain — books + relationships + memory in one Postgres store, asked through brain.ask and the four retrieval tiers.",
    provides: ["brain"],
    skills: [
      {
        id: "brain",
        source: "module",
        body: BRAIN_SKILL,
        priority: 70,
      },
    ],
    tools: [
      askTool,
      searchTool,
      queryTool,
      graphTool,
      rememberTool,
      forgetTool,
      approvalStatusTool,
      distillTool,
      curateTool,
      exportOkfTool,
      syncSchemaTool,
      ingestRowsTool,
    ],
    lifecycle: buildBrainLifecycle(db),
  };

  return module;
};

/**
 * Seeds the per-tenant brain maintenance routines (docs/brain.md §4.2/§4.5):
 *   • weekly distillation → brain.distill   (Mon 03:00 UTC)
 *   • daily   curation    → brain.curate    (03:30 UTC)
 * Each targets a one-block workflow that invokes the tool — the "smart
 * routine" pattern (CLAUDE.md): module-seeded routines drop their tool
 * linkage, so we raw-insert the workflow + the workflowId-bound routine.
 * Idempotent (keyed on name/title); fires for explicit install AND
 * new-tenant creation.
 */
function buildBrainLifecycle(db: Db): ModuleLifecycle {
  async function seedSmartRoutine(
    tenantId: string,
    opts: { wfName: string; routineTitle: string; tool: string; cron: string; description: string },
  ): Promise<void> {
    const existingWf = (await db.execute(sql`
      SELECT id FROM workflows WHERE tenant_id = ${tenantId} AND name = ${opts.wfName} LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    let workflowId = existingWf[0]?.id;
    if (!workflowId) {
      workflowId = randomUUID();
      const blocks = [
        { id: "trigger", name: "trigger", kind: "trigger", type: "trigger", config: { manual: true } },
        { id: "run", name: opts.tool, kind: "tool", type: "tool", tool: opts.tool, inputs: { scope: "tenant" }, config: {} },
      ];
      const edges = [{ id: "e1", sourceBlockId: "trigger", targetBlockId: "run", sourceHandle: null, sortOrder: 0 }];
      await db.execute(sql`
        INSERT INTO workflows (id, tenant_id, name, type, status, blocks, edges, created_at, updated_at)
        VALUES (${workflowId}, ${tenantId}, ${opts.wfName}, 'system', 'active',
          ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(edges)}::jsonb, now(), now())
      `);
    }
    const existingRt = (await db.execute(sql`
      SELECT id FROM routines WHERE tenant_id = ${tenantId} AND title = ${opts.routineTitle} LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    if (!existingRt[0]) {
      await db.execute(sql`
        INSERT INTO routines (id, tenant_id, title, description, workflow_id, cron_expression, timezone, status, concurrency_policy, created_at, updated_at)
        VALUES (${randomUUID()}, ${tenantId}, ${opts.routineTitle}, ${opts.description},
          ${workflowId}, ${opts.cron}, 'UTC', 'active', 'skip_if_active', now(), now())
      `);
    }
  }

  async function onInstall(ctx: ModuleContext): Promise<void> {
    await seedSmartRoutine(ctx.tenantId, {
      wfName: DISTILL_WORKFLOW_NAME,
      routineTitle: DISTILL_ROUTINE_TITLE,
      tool: "brain.distill",
      cron: "0 3 * * 1",
      description: "Compress 60-daily exhaust into weekly synthesis + promotions; dedup-reinforce the brain.",
    });
    await seedSmartRoutine(ctx.tenantId, {
      wfName: CURATE_WORKFLOW_NAME,
      routineTitle: CURATE_ROUTINE_TITLE,
      tool: "brain.curate",
      cron: "30 3 * * *",
      description: "Lint the memory tree: split oversized files, surface conflicts, fix pointers, flag stale content.",
    });
    await seedSmartRoutine(ctx.tenantId, {
      wfName: INGEST_WORKFLOW_NAME,
      routineTitle: INGEST_ROUTINE_TITLE,
      tool: "brain.ingest_rows",
      cron: "15 * * * *",
      description: "Index recent operational + module rows as brain row-pointers so brain.search/ask see live data.",
    });
  }

  return { onInstall, onTenantCreate: onInstall };
}

function notConfigured(): ToolResult {
  return {
    ok: false,
    error: { code: "upstream_unavailable", message: "Memory provider not configured", retryable: false },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

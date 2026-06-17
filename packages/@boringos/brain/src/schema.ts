// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Operational data as OKF (docs/brain-okf-compat.md, decisions #11/#12).
// Two halves:
//
//   materializeSchemaDocs — emit one OKF `type: table` concept doc per
//     operational/module table (columns from the LIVE information_schema,
//     descriptions enriched from a module's declared dataSchema), written
//     into `50-schema/` and indexed. This is the column-level catalog the
//     synthesis agent reads to write correct brain.query SQL.
//
//   ingestRows — index recent rows of those tables as brain ROW POINTERS
//     (source_kind:'row', source_ref:'<table>:<id>', a snippet only — by
//     reference, never a copy). Makes live data findable via brain.search
//     and joinable by brain.ask.
//
// Table identifiers are validated (never parameterizable) before
// interpolation; everything is tenant-scoped where the table carries
// tenant_id.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { renderFrontmatter } from "./frontmatter.js";
import type { BrainIndexer } from "./indexer.js";
import type { DriveLike } from "./provider.js";

export interface SchemaDeps {
  db: Db;
  drive: DriveLike;
  indexer: BrainIndexer;
}

/** A module's declared enrichment for its tables (the schema-as-SKILL
 *  contract). Columns/descriptions are merged onto the live introspection;
 *  the table list itself is still discovered from information_schema. */
export interface TableSchemaDecl {
  table: string;
  description?: string;
  columns?: Array<{ name: string; description?: string }>;
}

/** Human descriptions for the built-in operational tables (the core
 *  catalog the framework always ships). Columns come from the live DB. */
export const CORE_OPERATIONAL_SCHEMA: TableSchemaDecl[] = [
  {
    table: "inbox_items",
    description: "Inbound items (emails and connector events) routed into the tenant inbox.",
    columns: [
      { name: "subject", description: "subject / title of the item" },
      { name: "body", description: "full body text" },
      { name: "from", description: 'sender (quote the column: "from")' },
      { name: "status", description: "unread | read | snoozed | archived" },
      { name: "source", description: "origin connector, e.g. gmail" },
    ],
  },
  {
    table: "tasks",
    description: "Work items assigned to agents or users; the unit of agent work.",
    columns: [
      { name: "title", description: "task title" },
      { name: "status", description: "todo | in_progress | done | cancelled" },
      { name: "assignee_agent_id", description: "agent the task is assigned to" },
      { name: "origin_kind", description: "what created it (copilot, inbox.item_created, brain.ask, …)" },
    ],
  },
  {
    table: "task_comments",
    description: "Comments / the conversation transcript on a task. Agent replies land here.",
    columns: [
      { name: "task_id", description: "the task this comment belongs to" },
      { name: "body", description: "comment text" },
      { name: "author_agent_id", description: "agent author (null for human comments)" },
    ],
  },
  {
    table: "agent_runs",
    description: "History of agent executions — status, model, errors, timing.",
    columns: [
      { name: "agent_id", description: "agent that ran" },
      { name: "status", description: "queued | running | completed | failed | …" },
      { name: "error", description: "failure message, if any" },
    ],
  },
];

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const TEXT_TYPES = new Set(["text", "character varying", "varchar", "citext"]);
// Preference order for snippet columns when a table has several text cols.
const SNIPPET_PREF = ["subject", "title", "name", "summary", "body", "description", "content", "text"];

interface Column {
  name: string;
  type: string;
}

/** Columns of a table from information_schema (public schema). */
export async function introspectColumns(db: Db, table: string): Promise<Column[]> {
  if (!IDENT_RE.test(table)) return [];
  const rows = (await db.execute(sql`
    SELECT column_name AS name, data_type AS type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `)) as unknown as Column[];
  return rows;
}

/** Operational + module tables worth cataloguing: the core allowlist that
 *  exist, plus any `<prefix>__*` table (module/brain convention). */
export async function discoverTables(db: Db): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)) as unknown as Array<{ name: string }>;
  const core = new Set(CORE_OPERATIONAL_SCHEMA.map((t) => t.table));
  const out: string[] = [];
  for (const r of rows) {
    if (!IDENT_RE.test(r.name)) continue;
    if (core.has(r.name) || r.name.includes("__")) out.push(r.name);
  }
  return out.sort();
}

export interface MaterializeResult {
  tables: string[];
  written: number;
}

/** Write an OKF `type: table` concept doc per table into 50-schema/ and
 *  index it. `enrich` (core + module dataSchema) supplies descriptions. */
export async function materializeSchemaDocs(
  deps: SchemaDeps,
  opts: {
    tenantId: string;
    scope?: "tenant" | "user";
    ownerUserId?: string;
    now: Date;
    /** Restrict to these tables; default = discoverTables(). */
    tables?: string[];
    /** Description enrichment, keyed by table name. */
    enrich?: Record<string, TableSchemaDecl>;
  },
): Promise<MaterializeResult> {
  const scope = opts.scope ?? "tenant";
  const scopeRoot = scope === "tenant" ? "shared" : `users/${opts.ownerUserId}`;
  if (scope === "user" && !opts.ownerUserId) throw new Error("materializeSchemaDocs: user scope requires ownerUserId");
  const memRoot = `${scopeRoot}/memory`;
  const tables = opts.tables ?? (await discoverTables(deps.db));
  const enrich = opts.enrich ?? {};

  let written = 0;
  const done: string[] = [];
  for (const table of tables) {
    if (!IDENT_RE.test(table)) continue;
    const cols = await introspectColumns(deps.db, table);
    if (cols.length === 0) continue;
    const decl = enrich[table];
    const colDesc = new Map((decl?.columns ?? []).map((c) => [c.name, c.description ?? ""]));
    const tableDesc = decl?.description ?? `Operational table \`${table}\`.`;

    const rows = cols
      .map((c) => {
        const d = colDesc.get(c.name) ?? "";
        const name = c.name === "from" ? '"from"' : c.name;
        return `| ${name} | ${c.type} | ${d} |`;
      })
      .join("\n");

    const body =
      `# ${table}\n\n${tableDesc}\n\n` +
      `# Schema\n\n| column | type | description |\n|---|---|---|\n${rows}\n\n` +
      `# Examples\n\n` +
      "```sql\n" +
      `SELECT * FROM ${table} WHERE tenant_id = '<tenant_id>' LIMIT 20;\n` +
      "```\n";
    const doc = renderFrontmatter({
      type: "table",
      title: table,
      resource: `table:${table}`,
      description: tableDesc,
      timestamp: opts.now.toISOString(),
    }) + "\n" + body;

    const rel = `${memRoot}/50-schema/${table}.md`;
    const full = `${opts.tenantId}/${rel}`;
    // Idempotent on body (timestamp excluded), like distill's durable write.
    const prev = (await safeRead(deps.drive, full)) ?? "";
    const prevBody = stripFrontmatter(prev);
    if (prevBody.trim() !== body.trim()) {
      await deps.drive.write(full, doc);
      written += 1;
    }
    await deps.indexer.indexMemoryFile({ tenantId: opts.tenantId, path: rel, content: doc, scope, ownerUserId: opts.ownerUserId });
    done.push(table);
  }
  return { tables: done, written };
}

export interface IngestResult {
  byTable: Record<string, number>;
  total: number;
}

/** Index recent rows of operational/module tables as brain row pointers
 *  (by reference, decision #11). Tenant-scoped where the table has a
 *  tenant_id column; bounded by `limit` per table. Idempotent. */
export async function ingestRows(
  deps: SchemaDeps,
  opts: {
    tenantId: string;
    now: Date;
    tables?: string[];
    /** Max rows per table. Default 200. */
    limit?: number;
  },
): Promise<IngestResult> {
  const tables = opts.tables ?? (await discoverTables(deps.db));
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
  const byTable: Record<string, number> = {};
  let total = 0;

  for (const table of tables) {
    if (!IDENT_RE.test(table)) continue;
    if (table.startsWith("brain__")) continue; // don't index the mirror into itself
    const cols = await introspectColumns(deps.db, table);
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("id")) continue;
    const hasTenant = names.has("tenant_id");
    const hasCreated = names.has("created_at");
    // Pick up to 3 text-ish columns for the snippet, preference-ordered.
    const textCols = cols.filter((c) => TEXT_TYPES.has(c.type)).map((c) => c.name);
    textCols.sort((a, b) => prefIdx(a) - prefIdx(b));
    const picked = textCols.slice(0, 3);
    if (picked.length === 0) continue;

    const selectCols = picked.map((c) => (c === "from" ? `"from"` : c)).join(", ");
    const where = hasTenant ? sql`WHERE tenant_id = ${opts.tenantId}::uuid` : sql``;
    const order = hasCreated ? sql`ORDER BY created_at DESC` : sql``;
    // Table + columns are validated identifiers (sql.raw); the tenant
    // value is parameterized.
    let rows: Array<Record<string, unknown>>;
    try {
      rows = (await deps.db.execute(sql`
        SELECT id::text AS id, ${sql.raw(selectCols)}
        FROM ${sql.raw(table)}
        ${where} ${order}
        LIMIT ${limit}
      `)) as unknown as Array<Record<string, unknown>>;
    } catch {
      continue;
    }

    let n = 0;
    for (const row of rows) {
      const rowId = String(row.id);
      const snippet = picked
        .map((c) => String((row as Record<string, unknown>)[c] ?? "").trim())
        .filter((s) => s.length > 0)
        .join(" — ")
        .slice(0, 600);
      if (!snippet) continue;
      await deps.indexer.indexRowPointer({ tenantId: opts.tenantId, table, rowId, snippet });
      n += 1;
    }
    byTable[table] = n;
    total += n;
  }
  return { byTable, total };
}

// ── helpers ──────────────────────────────────────────────────────────

function prefIdx(name: string): number {
  const i = SNIPPET_PREF.indexOf(name);
  return i < 0 ? SNIPPET_PREF.length : i;
}

async function safeRead(drive: DriveLike, full: string): Promise<string | null> {
  try {
    if (!(await drive.exists(full))) return null;
    return await drive.readText(full);
  } catch {
    return null;
  }
}

function stripFrontmatter(content: string): string {
  const m = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? content.slice(m[0].length) : content;
}

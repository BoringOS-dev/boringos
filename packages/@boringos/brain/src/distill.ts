// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Distillation — progressive compression (docs/brain.md §4.2, §4.5).
//
// The pass that makes the brain self-maintaining, with ZERO LLM calls
// (the framework never calls a model directly; reasoning is a CLI
// agent's job — this is deterministic compression, the spine):
//
//   60-daily/ exhaust
//      │  ① dedup-reinforce: near-duplicate facts across days collapse
//      │     into one canonical row (access_count merges, importance
//      │     bumps) instead of N rows — the brain gets STRONGER, not fatter.
//      ▼
//   ② promote: each surviving fact is consolidated into its durable home —
//      entity facts → 10-domains/<slug>.md, decisions → 20-decisions/<slug>.md,
//      with a MEMORY.md pointer. The daily fragment is marked `promoted`
//      (raw history stays; the mirror's canonical home moves up a tier).
//      A changed durable file's prior version is retired to 99-archive/.
//      ▼
//   ③ 70-weekly/<weekId>.md synthesis: a digest of the week — entities,
//      decisions, activity — with provenance pointers.
//
// Idempotent: re-running the same window converges (unchanged files
// don't re-archive; pointers de-dupe; already-promoted fragments skip).

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { BrainIndexer } from "./indexer.js";
import { markFragmentPromoted } from "./daily.js";
import { slugify } from "./graph.js";
import { renderFrontmatter, parseFrontmatter, type Frontmatter } from "./frontmatter.js";
import type { DriveLike } from "./provider.js";

export interface DistillDeps {
  db: Db;
  drive: DriveLike;
  /** Used to re-index promoted + weekly files (whole-file). */
  indexer: BrainIndexer;
}

export interface DistillOptions {
  tenantId: string;
  scope?: "tenant" | "user";
  ownerUserId?: string;
  /** Reference "now" — the window ends here and the week id derives from it. */
  now: Date;
  /** Days back the window covers. Default 7. */
  windowDays?: number;
  /** Trigram-Jaccard similarity threshold for dedup. Default 0.6. */
  simThreshold?: number;
}

export interface DistillResult {
  weekId: string;
  scopeRoot: string;
  fragmentsConsidered: number;
  deduped: number;
  reinforced: number;
  promotedEntities: string[];
  promotedDecisions: number;
  archived: number;
  weeklyPath: string | null;
}

interface FragRow {
  id: string;
  source_ref: string;
  content: string;
  importance: number;
  access_count: number;
  created_at: Date | null;
}

const DECISION_RE =
  /\b(decided|decision|from now on|always|never|going forward|policy|standard|rule:)\b/i;

export async function distill(deps: DistillDeps, opts: DistillOptions): Promise<DistillResult> {
  const { db, drive, indexer } = deps;
  const scope = opts.scope ?? "tenant";
  const scopeRoot = scope === "tenant" ? "shared" : `users/${opts.ownerUserId}`;
  if (scope === "user" && !opts.ownerUserId) {
    throw new Error("distill: user scope requires ownerUserId");
  }
  const windowDays = opts.windowDays ?? 7;
  const simThreshold = opts.simThreshold ?? 0.6;
  const weekId = isoWeekId(opts.now);
  const memRoot = `${scopeRoot}/memory`;

  const windowStart = new Date(opts.now.getTime() - windowDays * 86_400_000);
  const inWindow = (ref: string): boolean => {
    const d = parseDailyDate(ref);
    if (!d) return false;
    const date = new Date(`${d}T00:00:00Z`);
    return date >= startOfDay(windowStart) && date <= opts.now;
  };

  const result: DistillResult = {
    weekId,
    scopeRoot,
    fragmentsConsidered: 0,
    deduped: 0,
    reinforced: 0,
    promotedEntities: [],
    promotedDecisions: 0,
    archived: 0,
    weeklyPath: null,
  };

  // ── Load this scope's live daily 'manual' fragments in the window ──
  const ownerClause = scope === "user" ? sql`AND owner_user_id = ${opts.ownerUserId}` : sql``;
  const allRows = (await db.execute(sql`
    SELECT id::text AS id, source_ref, content, importance, access_count, created_at
    FROM brain__memories
    WHERE tenant_id = ${opts.tenantId}::uuid AND deleted_at IS NULL
      AND scope = ${scope} ${ownerClause}
      AND source_kind = 'manual'
      AND source_ref LIKE '%/60-daily/%'
    ORDER BY created_at ASC
  `)) as unknown as FragRow[];
  const rows = allRows.filter((r) => inWindow(r.source_ref));
  result.fragmentsConsidered = rows.length;
  if (rows.length === 0) {
    // Still (re)write a weekly stub so the cadence is visible.
    result.weeklyPath = await writeWeekly(deps, memRoot, weekId, opts, result, [], []);
    return result;
  }

  // ── ① Dedup-reinforce ──────────────────────────────────────────────
  const clusters = clusterBySimilarity(rows, simThreshold);
  const survivors: FragRow[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      survivors.push(cluster[0]);
      continue;
    }
    // Canonical = most-accessed, then oldest.
    const canonical = [...cluster].sort(
      (a, b) => b.access_count - a.access_count || tms(a.created_at) - tms(b.created_at),
    )[0];
    const dups = cluster.filter((r) => r.id !== canonical.id);
    const mergedAccess =
      cluster.reduce((s, r) => s + (r.access_count ?? 0), 0) + dups.length;
    const mergedImportance = Math.min(
      1,
      Math.max(...cluster.map((r) => r.importance ?? 0.5)) + 0.05 * dups.length,
    );
    await db.execute(sql`
      UPDATE brain__memories
      SET access_count = ${mergedAccess}, importance = ${mergedImportance}, updated_at = now()
      WHERE id = ${canonical.id}::uuid
    `);
    for (const d of dups) {
      await db.execute(sql`
        UPDATE brain__memories SET deleted_at = now(), updated_at = now()
        WHERE id = ${d.id}::uuid
      `);
    }
    result.deduped += dups.length;
    result.reinforced += 1;
    survivors.push(canonical);
  }

  // ── ② Promote ──────────────────────────────────────────────────────
  // Partition survivors: decisions first (priority), then entity facts.
  const decisionFrags = survivors.filter((r) => DECISION_RE.test(factText(r.content)));
  const decided = new Set(decisionFrags.map((r) => r.id));
  const entityFrags = survivors.filter((r) => !decided.has(r.id));

  // Collect daily-file edits (mark promoted) to batch per file.
  const promoteMarks = new Map<string, Set<string>>(); // dailyRelPath -> subids
  const markPromoted = (ref: string) => {
    const [path, subid] = splitRef(ref);
    if (!path || !subid) return;
    if (!promoteMarks.has(path)) promoteMarks.set(path, new Set());
    promoteMarks.get(path)!.add(subid);
  };

  // Decisions → 20-decisions/<slug>.md
  for (const frag of decisionFrags) {
    const fact = factText(frag.content);
    const title = titleOf(fact);
    const slug = slugify(title) || slugify(fact).slice(0, 40) || "decision";
    const path = `${memRoot}/20-decisions/${slug}.md`;
    const body =
      `# ${title}\n\n${fact}\n\n(src: ${shortRef(frag.source_ref)}, promoted ${weekId})\n\n` +
      `# Citations\n\n[1] [${shortRef(frag.source_ref)}](/${memRoot}/${shortRef(frag.source_ref)})\n`;
    result.archived += await writeDurable(
      deps, opts.tenantId, path, { type: "decision", title }, body, weekId, memRoot, opts.now,
    );
    await indexer.indexMemoryFile({
      tenantId: opts.tenantId,
      path,
      content: body,
      scope,
      ownerUserId: opts.ownerUserId,
    });
    await ensureMemoryPointer(deps, opts.tenantId, memRoot, `20-decisions/${slug}.md`,
      `- [${title}](20-decisions/${slug}.md) — decision (${weekId})`);
    markPromoted(frag.source_ref);
    await softDeleteRow(db, frag.id);
    result.promotedDecisions += 1;
  }

  // Entity facts → 10-domains/<slug>.md (grouped via the mentions graph).
  if (entityFrags.length > 0) {
    const refs = entityFrags.map((r) => r.source_ref);
    const edges = (await db.execute(sql`
      SELECT src_id, dst_id FROM brain__edges
      WHERE tenant_id = ${opts.tenantId}::uuid AND deleted_at IS NULL
        AND edge_type = 'mentions' AND dst_type = 'topic'
        AND src_id IN (${sql.join(refs.map((r) => sql`${r}`), sql`, `)})
    `)) as unknown as Array<{ src_id: string; dst_id: string }>;
    // entity slug -> fragments mentioning it
    const byEntity = new Map<string, FragRow[]>();
    const fragByRef = new Map(entityFrags.map((f) => [f.source_ref, f]));
    for (const e of edges) {
      const f = fragByRef.get(e.src_id);
      if (!f) continue;
      if (!byEntity.has(e.dst_id)) byEntity.set(e.dst_id, []);
      byEntity.get(e.dst_id)!.push(f);
    }
    // entity names
    const slugs = [...byEntity.keys()];
    const names = new Map<string, string>();
    if (slugs.length > 0) {
      const nameRows = (await db.execute(sql`
        SELECT entity_id, name FROM brain__entities
        WHERE tenant_id = ${opts.tenantId}::uuid AND entity_type = 'topic'
          AND entity_id IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
      `)) as unknown as Array<{ entity_id: string; name: string }>;
      for (const n of nameRows) names.set(n.entity_id, n.name);
    }
    for (const [slug, frags] of byEntity) {
      const name = names.get(slug) ?? slug;
      const seen = new Set<string>();
      const bullets = frags
        .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
        .map((f) => `- ${factText(f.content)} (src: ${shortRef(f.source_ref)})`)
        .join("\n");
      const path = `${memRoot}/10-domains/${slug}.md`;
      const citeList = frags
        .filter((f) => (seen.has(`c:${f.id}`) ? false : (seen.add(`c:${f.id}`), true)))
        .map((f, i) => `[${i + 1}] [${shortRef(f.source_ref)}](/${memRoot}/${shortRef(f.source_ref)})`)
        .join("\n");
      const body =
        `# ${name}\n\n_Consolidated ${weekId} from daily memory._\n\n${bullets}\n\n` +
        `# Citations\n\n${citeList}\n`;
      result.archived += await writeDurable(
        deps, opts.tenantId, path, { type: "domain", title: name, resource: `topic:${slug}` }, body, weekId, memRoot, opts.now,
      );
      await indexer.indexMemoryFile({
        tenantId: opts.tenantId,
        path,
        content: body,
        scope,
        ownerUserId: opts.ownerUserId,
      });
      await ensureMemoryPointer(deps, opts.tenantId, memRoot, `10-domains/${slug}.md`,
        `- [${name}](10-domains/${slug}.md) — ${frags.length} fact(s) (${weekId})`);
      for (const f of frags) {
        markPromoted(f.source_ref);
        await softDeleteRow(db, f.id);
      }
      result.promotedEntities.push(slug);
    }
  }

  // Apply the `promoted` marks to the daily files (batched per file).
  for (const [dailyRelPath, subids] of promoteMarks) {
    const full = `${opts.tenantId}/${dailyRelPath}`;
    try {
      if (!(await drive.exists(full))) continue;
      let content = await drive.readText(full);
      let changed = false;
      for (const subid of subids) {
        const next = markFragmentPromoted(content, subid);
        if (next !== null) {
          content = next;
          changed = true;
        }
      }
      if (changed) await drive.write(full, content);
    } catch {
      /* marking is best-effort; the row soft-delete already compressed the mirror */
    }
  }

  // ── ③ Weekly synthesis ─────────────────────────────────────────────
  result.weeklyPath = await writeWeekly(deps, memRoot, weekId, opts, result, survivors, rows);

  return result;
}

// ── weekly note ──────────────────────────────────────────────────────

async function writeWeekly(
  deps: DistillDeps,
  memRoot: string,
  weekId: string,
  opts: DistillOptions,
  result: DistillResult,
  survivors: FragRow[],
  allWindowRows: FragRow[],
): Promise<string> {
  const path = `${memRoot}/70-weekly/${weekId}.md`;
  const byDay = new Map<string, number>();
  for (const r of allWindowRows) {
    const d = parseDailyDate(r.source_ref) ?? "?";
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const activity = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, n]) => `- ${d}: ${n} capture(s)`)
    .join("\n");

  const entityLines = result.promotedEntities
    .map((s) => `- [[${s}]] → 10-domains/${s}.md`)
    .join("\n");

  const lines = [
    `# Week ${weekId} synthesis`,
    "",
    `_${result.fragmentsConsidered} daily fact(s) distilled ${opts.now.toISOString().slice(0, 10)}._ ` +
      `${result.deduped} duplicate(s) merged · ${result.promotedEntities.length} entity file(s) · ${result.promotedDecisions} decision(s) promoted.`,
    "",
    "## Entities",
    entityLines || "_none this week_",
    "",
    "## Decisions",
    result.promotedDecisions > 0
      ? `_${result.promotedDecisions} promoted to 20-decisions/ this week._`
      : "_none this week_",
    "",
    "## Daily activity",
    activity || "_no captures_",
    "",
  ];
  const content =
    renderFrontmatter({ type: "weekly", title: `Week ${weekId}`, timestamp: opts.now.toISOString() }) +
    "\n" +
    lines.join("\n");
  await deps.drive.write(`${opts.tenantId}/${path}`, content);
  await deps.indexer.indexMemoryFile({
    tenantId: opts.tenantId,
    path,
    content,
    scope: opts.scope ?? "tenant",
    ownerUserId: opts.ownerUserId,
  });
  await ensureMemoryPointer(deps, opts.tenantId, memRoot, `70-weekly/${weekId}.md`,
    `- [Week ${weekId}](70-weekly/${weekId}.md) — synthesis`);
  return path;
}

// ── durable-file write with archive-on-change ────────────────────────

/** Write a durable OKF concept file: `fm` frontmatter + `body`. Idempotency
 *  is judged on the BODY (so a refreshed `timestamp` never defeats it). If
 *  the body changed, retire the old version to 99-archive/ first and stamp
 *  a fresh `timestamp`. Returns 1 if it archived, else 0. */
async function writeDurable(
  deps: DistillDeps,
  tenantId: string,
  path: string,
  fm: Frontmatter,
  body: string,
  weekId: string,
  memRoot: string,
  now: Date,
): Promise<number> {
  const full = `${tenantId}/${path}`;
  const doc = () => renderFrontmatter({ ...fm, timestamp: now.toISOString() }) + "\n" + body;
  try {
    if (await deps.drive.exists(full)) {
      const old = await deps.drive.readText(full);
      const { body: oldBody } = parseFrontmatter(old);
      if (oldBody.trim() === body.trim()) return 0; // body unchanged — idempotent
      const base = path.split("/").pop()?.replace(/\.md$/, "") ?? "file";
      // Archive files are OKF concepts too — stamp `type: archived` so the
      // whole bundle stays §9-conformant (the old content, incl. its own
      // frontmatter, is embedded in the body below the fence).
      await deps.drive.write(
        `${tenantId}/${memRoot}/99-archive/${base}-${weekId}.md`,
        renderFrontmatter({ type: "archived", title: `Archived ${base} (${weekId})`, timestamp: now.toISOString() }) +
          `\n# Archived ${base} (${weekId})\n\n${old}`,
      );
      await deps.drive.write(full, doc());
      return 1;
    }
  } catch {
    /* archive is best-effort */
  }
  await deps.drive.write(full, doc());
  return 0;
}

// ── MEMORY.md pointer (idempotent) ───────────────────────────────────

async function ensureMemoryPointer(
  deps: DistillDeps,
  tenantId: string,
  memRoot: string,
  targetPath: string,
  line: string,
): Promise<void> {
  const full = `${tenantId}/${memRoot}/MEMORY.md`;
  try {
    let content = (await deps.drive.exists(full))
      ? await deps.drive.readText(full)
      : `# Memory index\n\nPointers, not warehouses.\n\n## Promoted\n`;
    if (content.includes(`(${targetPath})`)) return; // pointer already present
    if (!content.includes("## Promoted")) {
      content = `${content.replace(/\s+$/, "")}\n\n## Promoted\n`;
    }
    content = `${content.replace(/\s+$/, "")}\n${line}\n`;
    await deps.drive.write(full, content);
  } catch {
    /* pointer is best-effort */
  }
}

// ── similarity clustering ────────────────────────────────────────────

function clusterBySimilarity(rows: FragRow[], threshold: number): FragRow[][] {
  const grams = rows.map((r) => shingles(factText(r.content)));
  const used = new Array(rows.length).fill(false);
  const clusters: FragRow[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (used[i]) continue;
    const cluster = [rows[i]];
    used[i] = true;
    for (let j = i + 1; j < rows.length; j++) {
      if (used[j]) continue;
      if (jaccard(grams[i], grams[j]) >= threshold) {
        cluster.push(rows[j]);
        used[j] = true;
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// ── helpers ──────────────────────────────────────────────────────────

async function softDeleteRow(db: Db, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE brain__memories SET deleted_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `);
}

function splitRef(ref: string): [string, string] {
  const i = ref.indexOf("#");
  return i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : [ref, ""];
}

/** Short provenance form: `60-daily/<date>#<subid>`. */
function shortRef(ref: string): string {
  const m = ref.match(/(60-daily\/\d{4}-\d{2}-\d{2}\.md#[\w.:-]+)/);
  return m ? m[1] : ref;
}

function parseDailyDate(ref: string): string | null {
  const m = ref.match(/60-daily\/(\d{4}-\d{2}-\d{2})\.md/);
  return m ? m[1] : null;
}

/** Strip a leading markdown heading line (the `### HH:MM` time header). */
function factText(body: string): string {
  return body.replace(/^\s*#{1,6}\s+.*(\r?\n)?/, "").trim();
}

function titleOf(fact: string): string {
  const firstLine = fact.split("\n")[0].replace(/^[-*]\s*/, "").trim();
  const words = firstLine.split(/\s+/).slice(0, 8).join(" ");
  return (words.length > 60 ? words.slice(0, 60) : words) || "Note";
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shingles(s: string, n = 3): Set<string> {
  const t = normalize(s);
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length <= n) {
    out.add(t);
    return out;
  }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function tms(d: Date | null): number {
  return d ? new Date(d).getTime() : 0;
}

function startOfDay(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

/** ISO-8601 week id: `YYYY-Www`. */
export function isoWeekId(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Curator / lint pass (docs/brain.md §4.5). The scheduled job that keeps
// the memory tree from rotting — deterministic, zero-LLM, idempotent.
// It applies the SAFE mechanical fixes and SURFACES the judgment calls:
//
//   • orphan pages        → add a MEMORY.md pointer            (auto-fix)
//   • broken pointers     → remove the dead MEMORY.md line     (auto-fix)
//   • oversized files     → split at ## boundaries + repoint   (auto-fix)
//   • contradictions      → prepend a CONFLICT: block (never resolve, that
//                           needs a human/decision)            (surface)
//   • missing (src:)      → flag promoted facts with no citation (report)
//   • stale daily         → flag unpromoted daily facts past the
//                           synthesis window (distillation owns promotion)
//
// Returns a CurateReport. Re-running converges (already-split files stay
// split; existing CONFLICT blocks aren't duplicated; pointers de-dupe).

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { DriveLike } from "./provider.js";
import type { BrainIndexer } from "./indexer.js";
import { hasConformantFrontmatter, withFrontmatter, parseFrontmatter } from "./frontmatter.js";

/** OKF version this bundle declares (docs/brain-okf-compat.md §5). */
export const OKF_VERSION = "0.1";
// Reserved filenames (OKF §6/§7 + our MEMORY.md index) — exempt from
// the `type`-frontmatter conformance rule, never auto-pointered/indexed.
const RESERVED = new Set(["index.md", "log.md", "MEMORY.md"]);

export interface CurateDeps {
  db: Db;
  drive: DriveLike;
  /** When set, durable files the curator rewrites are re-indexed so the
   *  brain mirror stays in sync (split parts, CONFLICT blocks). */
  indexer?: BrainIndexer;
}

export interface CurateOptions {
  tenantId: string;
  scope?: "tenant" | "user";
  ownerUserId?: string;
  now: Date;
  /** Files longer than this are split. Default 200. */
  maxLines?: number;
  /** Unpromoted daily facts older than this many days are flagged. Default 14. */
  staleDays?: number;
}

export interface CurateFinding {
  kind:
    | "orphan"
    | "broken_pointer"
    | "oversized"
    | "conflict"
    | "missing_citation"
    | "stale_daily"
    | "nonconformant"
    | "index";
  path: string;
  detail: string;
  fixed: boolean;
}

export interface CurateReport {
  scopeRoot: string;
  scanned: number;
  orphansFixed: number;
  brokenPointersFixed: number;
  filesSplit: number;
  conflictsSurfaced: number;
  citationsMissing: number;
  staleDaily: number;
  /** Files back-filled with OKF frontmatter (`type`) to become conformant. */
  conformanceFixed: number;
  /** Per-directory `index.md` files (re)written. */
  indexesWritten: number;
  okfVersion: string;
  findings: CurateFinding[];
}

// Durable folders the curator lints (NOT 60-daily — that's the raw
// landing zone owned by remember/distillation).
const DURABLE_DIRS = ["10-domains", "20-decisions", "30-people", "40-operations", "70-weekly"];

export async function curate(deps: CurateDeps, opts: CurateOptions): Promise<CurateReport> {
  const { db, drive } = deps;
  const scope = opts.scope ?? "tenant";
  const scopeRoot = scope === "tenant" ? "shared" : `users/${opts.ownerUserId}`;
  if (scope === "user" && !opts.ownerUserId) throw new Error("curate: user scope requires ownerUserId");
  const maxLines = opts.maxLines ?? 200;
  const staleDays = opts.staleDays ?? 14;
  const memRoot = `${scopeRoot}/memory`;

  const report: CurateReport = {
    scopeRoot,
    scanned: 0,
    orphansFixed: 0,
    brokenPointersFixed: 0,
    filesSplit: 0,
    conflictsSurfaced: 0,
    citationsMissing: 0,
    staleDaily: 0,
    conformanceFixed: 0,
    indexesWritten: 0,
    okfVersion: OKF_VERSION,
    findings: [],
  };
  const find = (f: CurateFinding) => report.findings.push(f);
  // Durable files the curator rewrote — re-indexed at the end so the
  // brain mirror reflects splits + CONFLICT blocks.
  const modified = new Set<string>();

  // Enumerate durable files (rel paths under memory/).
  const durableFiles: string[] = [];
  for (const dir of DURABLE_DIRS) {
    for (const rel of await walkFiles(drive, opts.tenantId, `${memRoot}/${dir}`)) {
      if (rel.endsWith(".md")) durableFiles.push(rel);
    }
  }
  report.scanned = durableFiles.length;

  const memoryMdRel = `${memRoot}/MEMORY.md`;
  let memoryMd = (await safeRead(drive, opts.tenantId, memoryMdRel)) ?? "# Memory index\n\nPointers, not warehouses.\n";

  // ── Oversized → split (do this first; it creates new part files) ──
  for (const rel of [...durableFiles]) {
    if (!notReserved(rel)) continue;
    const content = (await safeRead(drive, opts.tenantId, rel)) ?? "";
    if (countLines(content) <= maxLines) continue;
    const parts = splitOversized(content, maxLines);
    if (parts.length <= 1) continue;
    const base = rel.replace(/\.md$/, "");
    // Part 1 keeps the original path (+ a footer linking continuations).
    const contLinks = parts
      .slice(1)
      .map((_, i) => `${base.split("/").pop()}-part${i + 2}.md`);
    const part1 = `${parts[0].replace(/\s+$/, "")}\n\n---\n_Split by curator. Continued in: ${contLinks.join(", ")}._\n`;
    await drive.write(`${opts.tenantId}/${rel}`, part1);
    modified.add(rel);
    for (let i = 1; i < parts.length; i++) {
      const partRel = `${base}-part${i + 1}.md`;
      await drive.write(`${opts.tenantId}/${partRel}`, `${parts[i].replace(/\s+$/, "")}\n`);
      modified.add(partRel);
      durableFiles.push(partRel);
      // Point MEMORY.md at the new part.
      memoryMd = ensurePointer(memoryMd, partRel, `- [${titleFrom(partRel)}](${relTo(memRoot, partRel)}) — split part`);
    }
    report.filesSplit += 1;
    find({ kind: "oversized", path: rel, detail: `split into ${parts.length} parts`, fixed: true });
  }

  // ── Conformance: every concept doc needs OKF frontmatter with a
  //    non-empty `type` (OKF §9). Auto-fix: back-fill a folder-derived
  //    type — this is the migration path for legacy/seeded files. ──
  for (const rel of durableFiles) {
    if (!notReserved(rel)) continue;
    const content = (await safeRead(drive, opts.tenantId, rel)) ?? "";
    if (!content.trim()) continue;
    if (hasConformantFrontmatter(content)) continue;
    const type = folderType(rel);
    await drive.write(`${opts.tenantId}/${rel}`, withFrontmatter(content, { type, title: titleFrom(rel) }));
    modified.add(rel);
    report.conformanceFixed += 1;
    find({ kind: "nonconformant", path: rel, detail: `back-filled frontmatter type: ${type}`, fixed: true });
  }

  // ── Contradictions → CONFLICT: block (surface, never resolve) ──
  for (const rel of durableFiles) {
    if (!notReserved(rel)) continue;
    const content = (await safeRead(drive, opts.tenantId, rel)) ?? "";
    const conflicts = detectConflicts(content);
    let next = content;
    let added = 0;
    for (const c of conflicts) {
      const marker = `> CONFLICT: ${c.key}`;
      if (next.includes(marker)) continue; // already surfaced — idempotent
      const block = `${marker} — found ${c.values.join(" and ")}. Sources differ; resolve with a decision.\n\n`;
      next = prependAfterTitle(next, block);
      added += 1;
    }
    if (added > 0) {
      await drive.write(`${opts.tenantId}/${rel}`, next);
      modified.add(rel);
      report.conflictsSurfaced += added;
      find({ kind: "conflict", path: rel, detail: `${added} conflict(s) surfaced`, fixed: true });
    }
  }

  // ── Missing (src:) citations on promoted facts (report only) ──
  for (const rel of durableFiles) {
    if (!notReserved(rel)) continue;
    if (!/\/(10-domains|20-decisions)\//.test(rel)) continue;
    const content = (await safeRead(drive, opts.tenantId, rel)) ?? "";
    const bullets = content.split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l));
    const missing = bullets.filter((l) => !/\(src:/.test(l)).length;
    if (missing > 0) {
      report.citationsMissing += missing;
      find({ kind: "missing_citation", path: rel, detail: `${missing} fact(s) without (src:)`, fixed: false });
    }
  }

  // ── Broken pointers in MEMORY.md → remove (auto-fix) ──
  {
    const links = parseMemoryLinks(memoryMd);
    const kept: string[] = [];
    const lines = memoryMd.split("\n");
    const brokenTargets = new Set<string>();
    for (const link of links) {
      const targetRel = `${memRoot}/${link.target}`;
      const ok = await safeExists(drive, opts.tenantId, targetRel);
      if (!ok) brokenTargets.add(link.target);
    }
    if (brokenTargets.size > 0) {
      for (const line of lines) {
        const m = line.match(/\]\(([^)]+)\)/);
        if (m && brokenTargets.has(m[1])) {
          report.brokenPointersFixed += 1;
          find({ kind: "broken_pointer", path: memoryMdRel, detail: `removed dead pointer → ${m[1]}`, fixed: true });
          continue; // drop the line
        }
        kept.push(line);
      }
      memoryMd = kept.join("\n");
    }
  }

  // ── Orphans → add a MEMORY.md pointer (auto-fix) ──
  {
    const referenced = new Set(parseMemoryLinks(memoryMd).map((l) => `${memRoot}/${l.target}`));
    for (const rel of durableFiles) {
      if (!notReserved(rel)) continue; // index.md/log.md handled by the index pass
      // Skip continuation parts already pointed at during the split.
      if (referenced.has(rel)) continue;
      memoryMd = ensurePointer(memoryMd, rel, `- [${titleFrom(rel)}](${relTo(memRoot, rel)}) — (linted)`);
      report.orphansFixed += 1;
      find({ kind: "orphan", path: rel, detail: "added MEMORY.md pointer", fixed: true });
      referenced.add(rel);
    }
  }

  await drive.write(`${opts.tenantId}/${memoryMdRel}`, memoryMd.replace(/\s+$/, "") + "\n");

  // ── Per-directory index.md (OKF §6) + root okf_version (§11) ──
  {
    const byDir = new Map<string, string[]>();
    for (const rel of durableFiles) {
      if (!notReserved(rel)) continue;
      const dir = rel.slice(0, rel.lastIndexOf("/"));
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(rel);
    }
    const dirsWithIndex: string[] = [];
    for (const [dir, files] of [...byDir.entries()].sort()) {
      const lines = [`# ${dir.split("/").pop()}`, ""];
      for (const rel of files.sort()) {
        const { fm } = parseFrontmatter((await safeRead(drive, opts.tenantId, rel)) ?? "");
        const title = (typeof fm.title === "string" && fm.title) || titleFrom(rel);
        const desc = typeof fm.description === "string" ? fm.description : "";
        lines.push(`* [${title}](${rel.split("/").pop()})${desc ? " - " + desc : ""}`);
      }
      const idxRel = `${dir}/index.md`;
      const idxContent = lines.join("\n") + "\n";
      if ((await safeRead(drive, opts.tenantId, idxRel)) !== idxContent) {
        await drive.write(`${opts.tenantId}/${idxRel}`, idxContent);
        report.indexesWritten += 1;
        find({ kind: "index", path: idxRel, detail: `${files.length} entries`, fixed: true });
      }
      dirsWithIndex.push(dir);
    }
    // Root memory/index.md declares okf_version + links the folder indexes.
    const rootIdxRel = `${memRoot}/index.md`;
    const rootLines = ["# Memory", "", `okf_version: ${OKF_VERSION}`, ""];
    for (const dir of dirsWithIndex) {
      rootLines.push(`* [${dir.split("/").pop()}](${relTo(memRoot, dir)}/index.md)`);
    }
    const rootContent = rootLines.join("\n") + "\n";
    if ((await safeRead(drive, opts.tenantId, rootIdxRel)) !== rootContent) {
      await drive.write(`${opts.tenantId}/${rootIdxRel}`, rootContent);
      report.indexesWritten += 1;
    }
  }

  // ── Stale unpromoted daily facts (report only) ──
  {
    const ownerClause = scope === "user" ? sql`AND owner_user_id = ${opts.ownerUserId}` : sql``;
    const rows = (await db.execute(sql`
      SELECT source_ref FROM brain__memories
      WHERE tenant_id = ${opts.tenantId}::uuid AND deleted_at IS NULL
        AND scope = ${scope} ${ownerClause}
        AND source_kind = 'manual' AND source_ref LIKE '%/60-daily/%'
    `)) as unknown as Array<{ source_ref: string }>;
    const cutoff = new Date(opts.now.getTime() - staleDays * 86_400_000);
    for (const r of rows) {
      const d = (r.source_ref.match(/60-daily\/(\d{4}-\d{2}-\d{2})\.md/) ?? [])[1];
      if (!d) continue;
      if (new Date(`${d}T00:00:00Z`) < cutoff) {
        report.staleDaily += 1;
        find({ kind: "stale_daily", path: r.source_ref, detail: `unpromoted since ${d}`, fixed: false });
      }
    }
  }

  // ── Re-index rewritten durable files so the mirror stays in sync ──
  if (deps.indexer) {
    for (const rel of modified) {
      const content = await safeRead(drive, opts.tenantId, rel);
      if (content == null) continue;
      try {
        await deps.indexer.indexMemoryFile({
          tenantId: opts.tenantId,
          path: rel,
          content,
          scope,
          ownerUserId: opts.ownerUserId,
        });
      } catch {
        /* re-index is best-effort */
      }
    }
  }

  return report;
}

// ── conflict heuristic ───────────────────────────────────────────────

interface Conflict {
  key: string;
  values: string[];
}

/** Deterministic key-value contradiction detection (bounded patterns). */
export function detectConflicts(content: string): Conflict[] {
  const out: Conflict[] = [];
  const body = content.replace(/^>\s*CONFLICT:.*$/gim, ""); // ignore existing blocks

  // payment terms: net-30 vs net-45
  const net = new Set<string>();
  for (const m of body.matchAll(/\bnet-(\d{1,3})\b/gi)) net.add(`net-${m[1]}`);
  if (net.size >= 2) out.push({ key: "payment terms", values: [...net].sort() });

  // renewal month
  const months = "january|february|march|april|may|june|july|august|september|october|november|december";
  const monthSet = new Set<string>();
  for (const m of body.matchAll(new RegExp(`\\brenew\\w*[^.\\n]*?\\b(${months})\\b`, "gi"))) {
    monthSet.add(m[1].toLowerCase());
  }
  if (monthSet.size >= 2) out.push({ key: "renewal month", values: [...monthSet].sort() });

  return out;
}

// ── oversized split ──────────────────────────────────────────────────

/** Split content into parts each <= maxLines, preferring ## boundaries. */
export function splitOversized(content: string, maxLines: number): string[] {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return [content];
  const budget = Math.max(20, maxLines - 6); // leave room for the footer

  // Sections: preamble (before first ##) + each ## block.
  const sections: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line) && cur.length > 0) {
      sections.push(cur);
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) sections.push(cur);

  const parts: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) parts.push(buf.join("\n"));
    buf = [];
  };
  for (const sec of sections) {
    if (sec.length > budget) {
      // A single oversized section: hard-split by lines.
      flush();
      for (let i = 0; i < sec.length; i += budget) parts.push(sec.slice(i, i + budget).join("\n"));
      continue;
    }
    if (buf.length + sec.length > budget) flush();
    buf.push(...sec);
  }
  flush();
  return parts;
}

// ── MEMORY.md helpers ────────────────────────────────────────────────

interface MemLink {
  text: string;
  target: string;
}

function parseMemoryLinks(memoryMd: string): MemLink[] {
  const out: MemLink[] = [];
  for (const m of memoryMd.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    out.push({ text: m[1], target: m[2] });
  }
  return out;
}

/** Append a pointer line under "## Index" if its target isn't present. */
function ensurePointer(memoryMd: string, _absRel: string, line: string): string {
  const target = (line.match(/\]\(([^)]+)\)/) ?? [])[1];
  if (target && memoryMd.includes(`(${target})`)) return memoryMd;
  let next = memoryMd;
  if (!/^##\s+Index\s*$/m.test(next)) {
    next = `${next.replace(/\s+$/, "")}\n\n## Index\n`;
  }
  return `${next.replace(/\s+$/, "")}\n${line}\n`;
}

function prependAfterTitle(content: string, block: string): string {
  const lines = content.split("\n");
  let i = 0;
  // Skip a leading frontmatter fence (--- … ---) so we never split it.
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++; // past the closing ---
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  // Skip a `# Title` line + its blank line.
  if (/^#\s/.test(lines[i] ?? "")) {
    i++;
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  return [...lines.slice(0, i), block.replace(/\n+$/, ""), "", ...lines.slice(i)].join("\n");
}

// ── misc helpers ─────────────────────────────────────────────────────

function relTo(memRoot: string, rel: string): string {
  return rel.startsWith(`${memRoot}/`) ? rel.slice(memRoot.length + 1) : rel;
}

function titleFrom(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.md$/, "");
}

/** Reserved files (index.md/log.md/MEMORY.md) are exempt from concept rules. */
function notReserved(rel: string): boolean {
  return !RESERVED.has(rel.split("/").pop() ?? "");
}

/** Default OKF `type` derived from the numbered folder a doc lives in. */
function folderType(rel: string): string {
  if (rel.includes("/10-domains/")) return "domain";
  if (rel.includes("/20-decisions/")) return "decision";
  if (rel.includes("/30-people/")) return "person";
  if (rel.includes("/40-operations/")) return "operation";
  if (rel.includes("/70-weekly/")) return "weekly";
  return "note";
}

function countLines(s: string): number {
  return s.split("\n").length;
}

async function safeRead(drive: DriveLike, tenantId: string, rel: string): Promise<string | null> {
  try {
    if (!(await drive.exists(`${tenantId}/${rel}`))) return null;
    return await drive.readText(`${tenantId}/${rel}`);
  } catch {
    return null;
  }
}

async function safeExists(drive: DriveLike, tenantId: string, rel: string): Promise<boolean> {
  try {
    return await drive.exists(`${tenantId}/${rel}`);
  } catch {
    return false;
  }
}

/** Recursively list .md file rel-paths under a memory subtree. */
async function walkFiles(drive: DriveLike, tenantId: string, relPrefix: string): Promise<string[]> {
  const out: string[] = [];
  const HARD_CAP = 2000;
  async function walk(prefix: string): Promise<void> {
    if (out.length >= HARD_CAP) return;
    let entries: Array<{ path: string; name: string; isDirectory: boolean }>;
    try {
      entries = await drive.list(prefix);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= HARD_CAP) break;
      if (e.isDirectory) await walk(e.path);
      else {
        const rel = e.path.startsWith(`${tenantId}/`) ? e.path.slice(tenantId.length + 1) : e.path;
        out.push(rel);
      }
    }
  }
  await walk(`${tenantId}/${relPrefix}`);
  return out;
}

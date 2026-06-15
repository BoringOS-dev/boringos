// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Memory tree v2 — the append-only daily note (docs/brain.md §4.5).
//
// `60-daily/YYYY-MM-DD.md` is the landing zone for both remembered
// facts and run checkpoints. Each entry is a "fragment" delimited by
// an invisible HTML-comment marker so the file stays human-readable
// while every fragment is independently:
//   - indexable into the brain (source_ref = `<dailyPath>#<subid>`),
//   - strikeable by `forget` (remove just that block),
//   - garbage-collectable when it disappears from the file.
//
// Marker:  <!-- frag <kind> <subid> <iso-ts> -->
//   kind   = 'mem' (a remembered fact) | 'run' (a run checkpoint)
//   subid  = stable id unique within the file (content hash / run id)
// A fragment's body is everything between its marker and the next
// marker (or EOF). The readable `###`/`##` header lives inside the body.

import { renderFrontmatter } from "./frontmatter.js";

export type FragmentKind = "mem" | "run";

export interface DailyFragment {
  kind: FragmentKind;
  subid: string;
  ts: string;
  /** Text between this marker and the next (trimmed). Excludes the marker line. */
  body: string;
  /**
   * True when the distillation pass has promoted this fact into a
   * durable folder (10-domains/20-decisions). Promoted fragments stay
   * in the daily file as raw history but are SKIPPED by the brain
   * mirror — their canonical home is now the promoted file (§4.5
   * progressive compression).
   */
  promoted: boolean;
}

// A frag marker is `<!-- frag <kind> <subid> <ts> [flags…] -->`. We
// tokenize the inner span rather than positional-regex so trailing
// flags (e.g. `promoted`) parse cleanly. subid is permissive: hex
// content-hashes AND run ids (uuids, "run-2", …).
const MARKER_RE = /^<!--\s*frag\s+(.+?)\s*-->\s*$/i;

interface ParsedMarker {
  kind: FragmentKind;
  subid: string;
  ts: string;
  promoted: boolean;
}

function parseMarker(line: string): ParsedMarker | null {
  const m = line.match(MARKER_RE);
  if (!m) return null;
  const toks = m[1].split(/\s+/);
  if (toks.length < 3) return null;
  const kind = toks[0].toLowerCase();
  if (kind !== "mem" && kind !== "run") return null;
  const flags = toks.slice(3).map((t) => t.toLowerCase());
  return { kind, subid: toks[1], ts: toks[2], promoted: flags.includes("promoted") };
}

/** Is this drive path a v2 daily note? (`…/60-daily/<name>.md`) */
export function isDailyNotePath(relPath: string): boolean {
  return /(^|\/)60-daily\/[^/]+\.md$/.test(relPath);
}

/** The UTC date stamp (`YYYY-MM-DD`) for a daily-note filename. */
export function dailyDateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function fragmentMarker(
  kind: FragmentKind,
  subid: string,
  ts: string,
  promoted = false,
): string {
  return `<!-- frag ${kind} ${subid} ${ts}${promoted ? " promoted" : ""} -->`;
}

/** Render an appendable fragment block (marker + readable header + body). */
export function renderFragmentBlock(opts: {
  kind: FragmentKind;
  subid: string;
  ts: string;
  header?: string;
  body: string;
}): string {
  const lines = [fragmentMarker(opts.kind, opts.subid, opts.ts)];
  if (opts.header) lines.push(opts.header);
  lines.push("", opts.body.trim(), "");
  return `\n${lines.join("\n")}`;
}

/** Parse a daily note into its ordered fragments. */
export function parseDailyFragments(content: string): DailyFragment[] {
  const lines = content.split("\n");
  const markers: Array<{ i: number } & ParsedMarker> = [];
  for (let i = 0; i < lines.length; i++) {
    const p = parseMarker(lines[i]);
    if (p) markers.push({ i, ...p });
  }
  const out: DailyFragment[] = [];
  for (let k = 0; k < markers.length; k++) {
    const start = markers[k].i;
    const end = k + 1 < markers.length ? markers[k + 1].i : lines.length;
    const body = lines.slice(start + 1, end).join("\n").trim();
    out.push({
      kind: markers[k].kind,
      subid: markers[k].subid,
      ts: markers[k].ts,
      promoted: markers[k].promoted,
      body,
    });
  }
  return out;
}

/**
 * Remove the fragment with `subid` from a daily note's content. Returns
 * the new content, or null if the fragment wasn't found. Removes the
 * marker line through the line before the next marker (or EOF), then
 * collapses the blank-line run it left behind.
 */
export function stripFragment(content: string, subid: string): string | null {
  const lines = content.split("\n");
  const markers: Array<{ i: number; subid: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const p = parseMarker(lines[i]);
    if (p) markers.push({ i, subid: p.subid });
  }
  const target = markers.findIndex((mk) => mk.subid === subid);
  if (target < 0) return null;
  const start = markers[target].i;
  const end = target + 1 < markers.length ? markers[target + 1].i : lines.length;
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/**
 * Mark a fragment as promoted in-place (rewrite its marker line to add
 * the `promoted` flag). Returns the new content, or null if not found
 * or already promoted. The fragment's body is untouched — it stays in
 * the daily note as raw history; only the mirror skips it afterwards.
 */
export function markFragmentPromoted(content: string, subid: string): string | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const p = parseMarker(lines[i]);
    if (p && p.subid === subid) {
      if (p.promoted) return null;
      lines[i] = fragmentMarker(p.kind, p.subid, p.ts, true);
      return lines.join("\n");
    }
  }
  return null;
}

/** The header a brand-new daily note opens with — OKF frontmatter
 *  (`type: daily`) + a human heading. Fragments append below; the
 *  frontmatter is preamble (before the first marker) so the fragment
 *  parser ignores it. */
export function dailyNoteHeader(dateStamp: string): string {
  return (
    renderFrontmatter({ type: "daily", title: dateStamp, timestamp: `${dateStamp}T00:00:00Z` }) +
    `\n# ${dateStamp}\n\n` +
    `Append-only daily memory — remembered facts + run checkpoints. ` +
    `Promoted to \`10-domains/\`/\`20-decisions/\` and archived to \`99-archive/\` ` +
    `at synthesis. Don't hand-edit history; let curation move it.\n`
  );
}

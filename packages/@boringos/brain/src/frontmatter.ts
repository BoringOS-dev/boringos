// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OKF-compatible YAML frontmatter (docs/brain-okf-compat.md). Every
// concept doc the Brain writes carries a `---` block with a required
// `type` (OKF's one required field) + optional title/description/
// resource/tags/timestamp. We hand-roll a MINIMAL parser/renderer
// sufficient for our own output and tolerant of simple external OKF —
// no YAML dependency. A consumer that wants full YAML can use one;
// per OKF, consumers MUST tolerate what they can't parse.

export interface Frontmatter {
  /** OKF's required field — the kind of concept (routing/filtering). */
  type?: string;
  title?: string;
  description?: string;
  /** Canonical URI / pointer to the underlying asset (decision #11). */
  resource?: string;
  tags?: string[];
  /** ISO-8601 last-modified. */
  timestamp?: string;
  [key: string]: unknown;
}

const FENCE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** Render a `---` frontmatter block (trailing newline). `type` first. */
export function renderFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  const emit = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => quoteIfNeeded(String(x))).join(", ")}]`);
    } else {
      lines.push(`${k}: ${quoteIfNeeded(String(v))}`);
    }
  };
  // Stable key order: type first (OKF), then the recommended fields,
  // then any extras.
  emit("type", fm.type);
  for (const k of ["title", "description", "resource", "tags", "timestamp"] as const) {
    emit(k, fm[k]);
  }
  for (const k of Object.keys(fm)) {
    if (["type", "title", "description", "resource", "tags", "timestamp"].includes(k)) continue;
    emit(k, fm[k]);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/**
 * Split a leading frontmatter block from the body. Returns the parsed
 * fields + the body after the fence (no fence → empty fm, body = input).
 */
export function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
  const m = content.match(FENCE);
  if (!m) return { fm: {}, body: content };
  const fm: Frontmatter = {};
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter((s) => s.length > 0);
    } else {
      fm[key] = unquote(val);
    }
  }
  return { fm, body: content.slice(m[0].length) };
}

/** Has this content a parseable frontmatter block with a non-empty type? */
export function hasConformantFrontmatter(content: string): boolean {
  const m = content.match(FENCE);
  if (!m) return false;
  const { fm } = parseFrontmatter(content);
  return typeof fm.type === "string" && fm.type.trim().length > 0;
}

/** Prepend/replace the frontmatter on a doc, preserving the body. */
export function withFrontmatter(content: string, fm: Frontmatter): string {
  const { body } = parseFrontmatter(content);
  return renderFrontmatter(fm) + body;
}

function quoteIfNeeded(s: string): string {
  // Quote when the value could confuse the minimal parser.
  if (/^[\w./:-][\w ./:@+#-]*$/.test(s) && !/^\s|\s$/.test(s)) return s;
  return JSON.stringify(s);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

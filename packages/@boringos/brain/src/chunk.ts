// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Heading-aware chunker (docs/brain.md §4.2). Files and long memories
// are split at ~1k tokens with ~150-token overlap; each chunk is its
// own brain__memories row so a cited claim resolves to the exact
// passage, not a whole file.
//
// Token budget is approximated as chars/4 (the standard rough ratio)
// — we don't ship a tokenizer for a sizing heuristic. The split
// prefers markdown heading boundaries, then paragraph boundaries,
// then a hard character cut, so chunks stay semantically coherent.

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 1000;
const OVERLAP_TOKENS = 150;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN; // ~4000
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // ~600

export interface Chunk {
  index: number;
  content: string;
}

/**
 * Split `content` into ordered chunks. Short content returns a single
 * chunk (index 0). Frontmatter is left in the first chunk — it carries
 * tags/dates the indexer parses for the graph tier.
 */
export function chunkContent(content: string): Chunk[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= TARGET_CHARS) {
    return [{ index: 0, content: trimmed }];
  }

  // 1. Split into heading-bounded sections. A line starting with one
  //    or more '#' opens a new section; everything until the next
  //    heading belongs to it.
  const sections = splitByHeadings(trimmed);

  // 2. Pack sections into chunks up to TARGET_CHARS. A section larger
  //    than the target is itself split by paragraphs / hard cut.
  const rawChunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim().length > 0) rawChunks.push(buf.trim());
    buf = "";
  };
  for (const section of sections) {
    if (section.length > TARGET_CHARS) {
      flush();
      for (const piece of splitOversized(section)) rawChunks.push(piece);
      continue;
    }
    if (buf.length + section.length > TARGET_CHARS) flush();
    buf += (buf.length ? "\n\n" : "") + section;
  }
  flush();

  // 3. Add a tail overlap from the previous chunk so a claim that
  //    straddles a boundary is still retrievable from either side.
  const withOverlap: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    if (i === 0) {
      withOverlap.push(rawChunks[i]);
      continue;
    }
    const prev = rawChunks[i - 1];
    const tail = prev.slice(Math.max(0, prev.length - OVERLAP_CHARS));
    withOverlap.push(`${tail}\n\n${rawChunks[i]}`);
  }

  return withOverlap.map((content, index) => ({ index, content }));
}

function splitByHeadings(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join("\n"));
  return sections;
}

function splitOversized(section: string): string[] {
  const paras = section.split(/\n{2,}/);
  const out: string[] = [];
  let buf = "";
  for (const para of paras) {
    if (para.length > TARGET_CHARS) {
      // A single mega-paragraph: hard-cut on character boundaries.
      if (buf.trim()) {
        out.push(buf.trim());
        buf = "";
      }
      for (let i = 0; i < para.length; i += TARGET_CHARS) {
        out.push(para.slice(i, i + TARGET_CHARS));
      }
      continue;
    }
    if (buf.length + para.length > TARGET_CHARS) {
      out.push(buf.trim());
      buf = "";
    }
    buf += (buf.length ? "\n\n" : "") + para;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

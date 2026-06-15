// Brain engine — pure-function unit tests (docs/brain.md §4.2, §4.3).
// No DB: chunker, wikilink extraction, slug normalization, vector
// literal rendering, embedder ladder resolution.

import { describe, it, expect } from "vitest";
import {
  chunkContent,
  extractWikilinks,
  slugify,
  toVectorLiteral,
  resolveEmbedder,
  nullEmbedder,
  EMBED_DIMS,
  isDailyNotePath,
  dailyDateStamp,
  renderFragmentBlock,
  parseDailyFragments,
  stripFragment,
} from "@boringos/brain";

describe("brain — chunker", () => {
  it("returns a single chunk for short content", () => {
    const chunks = chunkContent("a short note about pricing");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toContain("pricing");
  });

  it("returns no chunks for empty/whitespace content", () => {
    expect(chunkContent("")).toHaveLength(0);
    expect(chunkContent("   \n  ")).toHaveLength(0);
  });

  it("splits long content into ordered, overlapping chunks", () => {
    // Build a doc well over the ~4000-char target with headings.
    const section = (h: string, n: number) =>
      `## ${h}\n\n` + `Detail line about ${h}. `.repeat(n);
    const doc = [
      section("Alpha", 120),
      section("Bravo", 120),
      section("Charlie", 120),
    ].join("\n\n");

    const chunks = chunkContent(doc);
    expect(chunks.length).toBeGreaterThan(1);
    // Indexes are contiguous starting at 0.
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Overlap: a later chunk carries a tail of the previous one.
    expect(chunks[1].content.length).toBeGreaterThan(0);
  });

  it("hard-splits a single oversized paragraph", () => {
    const mega = "x".repeat(20000);
    const chunks = chunkContent(mega);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk wildly exceeds the target (allow the overlap margin).
    for (const c of chunks) expect(c.content.length).toBeLessThan(6000);
  });
});

describe("brain — wikilinks + slug", () => {
  it("extracts [[wikilink]] targets and handles aliases", () => {
    const links = extractWikilinks(
      "We met [[Acme Corp]] about [[Project Phoenix|phoenix]] and [[Acme Corp]] again.",
    );
    expect(links).toContain("Acme Corp");
    expect(links).toContain("Project Phoenix");
    // De-duplicated.
    expect(links.filter((l) => l === "Acme Corp")).toHaveLength(1);
  });

  it("ignores non-wikilink brackets", () => {
    expect(extractWikilinks("a [normal](link) and [single] brackets")).toHaveLength(0);
  });

  it("slugifies names to stable ids", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
    expect(slugify("  Project   Phoenix!! ")).toBe("project-phoenix");
    expect(slugify("ABC")).toBe("abc");
  });
});

describe("brain — embedder ladder", () => {
  it("falls back to the FTS floor (null model) with no API key", () => {
    const e = resolveEmbedder({} as NodeJS.ProcessEnv);
    expect(e.model).toBeNull();
    expect(e.dims).toBe(EMBED_DIMS);
  });

  it("resolves an OpenAI embedder when a key is present", () => {
    const e = resolveEmbedder({ EMBEDDING_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
    expect(e.model).toBe("text-embedding-3-small");
    expect(e.dims).toBe(768);
  });

  it("falls back to the floor for an unimplemented provider", () => {
    const e = resolveEmbedder({
      EMBEDDING_API_KEY: "x",
      EMBEDDING_PROVIDER: "voyage",
    } as NodeJS.ProcessEnv);
    expect(e.model).toBeNull();
  });

  it("nullEmbedder.embed returns nothing", async () => {
    expect(await nullEmbedder.embed(["a", "b"])).toEqual([]);
  });

  it("renders a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
});

describe("brain — memory tree v2 daily fragments", () => {
  it("detects daily-note paths", () => {
    expect(isDailyNotePath("shared/memory/60-daily/2026-06-14.md")).toBe(true);
    expect(isDailyNotePath("users/u/memory/60-daily/x.md")).toBe(true);
    expect(isDailyNotePath("shared/memory/20-decisions/pricing.md")).toBe(false);
    expect(isDailyNotePath("shared/memory/MEMORY.md")).toBe(false);
  });

  it("stamps the UTC date", () => {
    expect(dailyDateStamp(new Date("2026-06-14T23:30:00Z"))).toBe("2026-06-14");
  });

  it("render → parse round-trips a single fragment", () => {
    const block = renderFragmentBlock({
      kind: "mem",
      subid: "7f3a9c2b",
      ts: "2026-06-14T09:12:00Z",
      header: "### 09:12 · budget",
      body: "The Q3 budget for [[Project Atlas]] is $48,000.",
    });
    const frags = parseDailyFragments(block);
    expect(frags).toHaveLength(1);
    expect(frags[0].kind).toBe("mem");
    expect(frags[0].subid).toBe("7f3a9c2b");
    expect(frags[0].body).toContain("Project Atlas");
    expect(frags[0].body).toContain("### 09:12"); // readable header lives in the body
  });

  it("parses multiple ordered fragments (mem + run mixed)", () => {
    const content =
      renderFragmentBlock({ kind: "mem", subid: "aaaa1111", ts: "t1", body: "fact one" }) +
      "\n" +
      renderFragmentBlock({ kind: "run", subid: "run-xyz", ts: "t2", header: "## 10:00 run run-xyz", body: "did stuff" }) +
      "\n" +
      renderFragmentBlock({ kind: "mem", subid: "bbbb2222", ts: "t3", body: "fact two" });
    const frags = parseDailyFragments(content);
    expect(frags.map((f) => f.subid)).toEqual(["aaaa1111", "run-xyz", "bbbb2222"]);
    expect(frags[1].kind).toBe("run");
    expect(frags[0].body).toBe("fact one");
    expect(frags[2].body).toBe("fact two");
  });

  it("strips a fragment by subid, leaving siblings intact", () => {
    const content =
      "# 2026-06-14\n" +
      renderFragmentBlock({ kind: "mem", subid: "keep0001", ts: "t1", body: "keep me" }) +
      "\n" +
      renderFragmentBlock({ kind: "mem", subid: "drop0002", ts: "t2", body: "drop me" });
    const next = stripFragment(content, "drop0002");
    expect(next).not.toBeNull();
    expect(next).toContain("keep me");
    expect(next).not.toContain("drop me");
    expect(parseDailyFragments(next as string).map((f) => f.subid)).toEqual(["keep0001"]);
  });

  it("stripping a missing fragment returns null", () => {
    const content = renderFragmentBlock({ kind: "mem", subid: "only0001", ts: "t1", body: "x" });
    expect(stripFragment(content, "nope9999")).toBeNull();
  });
});

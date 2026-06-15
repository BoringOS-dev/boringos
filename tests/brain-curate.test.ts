// Curator / lint pass — Unit 3 (docs/brain.md §4.5). Pure-function units
// + a real-PG integration that seeds a tree with a citation, a
// contradiction, an oversized file, an orphan, a broken pointer, a
// missing citation, and a stale daily fact, then asserts the lint +
// idempotency. FTS floor.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDbConfig } from "./_helpers.js";
import { createLocalStorage } from "@boringos/drive";
import {
  createIndexer,
  curate,
  extractCitations,
  detectConflicts,
  splitOversized,
  nullEmbedder,
  __resetCapabilityCache,
} from "@boringos/brain";
import type { Db, DatabaseConnection } from "@boringos/db";

const TENANT = "33333333-3333-3333-3333-3333333333cc";

describe("brain — curator (Unit 3) units", () => {
  it("extractCitations parses the (src: …) forms", () => {
    const cits = extractCitations(
      "A (src: [[Acme Corp]]). B (src: inbox_items:abc). C (src: task:1234, 2026-06-12). D (src: 60-daily/2026-06-10.md#x).",
    );
    const ids = cits.map((c) => `${c.dstType}:${c.dstId}`);
    expect(ids).toContain("topic:acme-corp");
    expect(ids).toContain("row:inbox_items:abc");
    expect(ids).toContain("row:task:1234");
    expect(ids.some((i) => i.startsWith("memory:60-daily/"))).toBe(true);
  });

  it("detectConflicts flags conflicting key-values", () => {
    const c1 = detectConflicts("- Terms: net-30\n- Updated: net-45");
    expect(c1.find((c) => c.key === "payment terms")?.values).toEqual(["net-30", "net-45"]);
    // single value → no conflict
    expect(detectConflicts("- Terms: net-30 only")).toHaveLength(0);
    // ignores an existing CONFLICT block
    expect(detectConflicts("> CONFLICT: payment terms — found net-30 and net-45.\n- net-30")).toHaveLength(0);
  });

  it("splitOversized splits at headings, keeps parts bounded", () => {
    const content = "# Big\n\n" + Array.from({ length: 40 }, (_, i) => `## S${i}\nx\ny\nz\n`).join("\n");
    const parts = splitOversized(content, 50);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.split("\n").length).toBeLessThanOrEqual(50);
    // small content → single part
    expect(splitOversized("# Small\n\njust a bit\n", 200)).toHaveLength(1);
  });
});

describe("brain — curator (Unit 3) integration", () => {
  let dataDir: string;
  let driveDir: string;
  let dbConn: DatabaseConnection;
  let db: Db;
  let drive: ReturnType<typeof createLocalStorage>;
  let indexer: ReturnType<typeof createIndexer>;

  const writeMem = (rel: string, content: string) => drive.write(`${TENANT}/shared/memory/${rel}`, content);
  const readMem = (rel: string) => drive.readText(`${TENANT}/shared/memory/${rel}`).catch(() => null);
  const existsMem = (rel: string) => drive.exists(`${TENANT}/shared/memory/${rel}`);

  beforeAll(async () => {
    __resetCapabilityCache();
    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "brain-curate-pg-"));
    driveDir = await mkdtemp(join(tmpdir(), "brain-curate-drive-"));
    dbConn = (await createDatabase(testDbConfig(dataDir, 5619))) as DatabaseConnection;
    db = dbConn.db;
    await createMigrationManager(db as never).apply();
    await db.execute(sql`
      INSERT INTO tenants (id, name, slug) VALUES (${TENANT}::uuid, 'Curate Test', 'curate-test')
      ON CONFLICT (id) DO NOTHING
    `);
    drive = createLocalStorage({ root: driveDir });
    indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
  }, 90_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(driveDir, { recursive: true, force: true });
  });

  it("indexing a (src: …) citation wires a 'cites' provenance edge", async () => {
    await indexer.index({
      tenantId: TENANT,
      sourceKind: "manual",
      sourceRef: "shared/memory/10-domains/beta.md",
      content: "Beta Co is a partner. (src: [[Beta Co]])",
    });
    const edges = (await db.execute(sql`
      SELECT edge_type, dst_type, dst_id FROM brain__edges
      WHERE tenant_id = ${TENANT}::uuid AND edge_type = 'cites' AND dst_id = 'beta-co' AND deleted_at IS NULL
    `)) as unknown as Array<{ edge_type: string; dst_type: string; dst_id: string }>;
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].dst_type).toBe("topic");
  });

  it("lints a seeded tree: split, conflict, orphan, broken-pointer, missing-cite, stale", async () => {
    // MEMORY.md: one broken pointer + one valid pointer.
    await writeMem(
      "MEMORY.md",
      "# Memory index\n\n## Index\n- [Gone](10-domains/gone.md) — dead\n- [Acme](10-domains/acme.md) — Enterprise\n",
    );
    // contradiction (two net-terms) + cited facts.
    await writeMem("10-domains/acme.md", "# Acme\n\n- Terms: net-30 (src: task:1)\n- Revised: net-45 (src: task:2)\n");
    // orphan (not referenced in MEMORY.md).
    await writeMem("10-domains/orphan.md", "# Orphan\n\n- A fact (src: task:9)\n");
    // oversized (~360 lines).
    const big = "# Big\n\n" + Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nline a\nline b\nline c\nline d\n`).join("\n");
    await writeMem("10-domains/big.md", big);
    // a promoted fact missing (src:).
    await writeMem("20-decisions/policy.md", "# Policy\n\n- We always do X.\n");
    // a stale unpromoted daily fact in the mirror (Jan 1).
    await indexer.index({
      tenantId: TENANT,
      sourceKind: "manual",
      sourceRef: "shared/memory/60-daily/2026-01-01.md#old",
      content: "An old [[Thing]] never promoted.",
    });

    const now = new Date("2026-06-14T12:00:00Z");
    const r = await curate({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now, maxLines: 200, staleDays: 14 });

    // split
    expect(r.filesSplit).toBeGreaterThanOrEqual(1);
    expect(await existsMem("10-domains/big-part2.md")).toBe(true);
    expect((await readMem("10-domains/big.md"))!.split("\n").length).toBeLessThanOrEqual(206);
    // conflict surfaced, not resolved
    expect(r.conflictsSurfaced).toBeGreaterThanOrEqual(1);
    expect(await readMem("10-domains/acme.md")).toContain("> CONFLICT: payment terms");
    // orphan → pointer added
    expect(r.orphansFixed).toBeGreaterThanOrEqual(1);
    const mem = await readMem("MEMORY.md");
    expect(mem).toContain("10-domains/orphan.md");
    expect(mem).toContain("10-domains/big-part2.md");
    // broken pointer removed
    expect(r.brokenPointersFixed).toBeGreaterThanOrEqual(1);
    expect(mem).not.toContain("10-domains/gone.md");
    // missing citation flagged
    expect(r.citationsMissing).toBeGreaterThanOrEqual(1);
    // stale daily flagged
    expect(r.staleDaily).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const now = new Date("2026-06-14T12:30:00Z");
    const r = await curate({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now, maxLines: 200, staleDays: 14 });
    expect(r.filesSplit).toBe(0); // already split
    expect(r.conflictsSurfaced).toBe(0); // CONFLICT already present
    expect(r.orphansFixed).toBe(0); // all pointed
    expect(r.brokenPointersFixed).toBe(0); // already removed
  });
});

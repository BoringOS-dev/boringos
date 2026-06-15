// Brain — integration tests against a real embedded Postgres
// (docs/brain.md). Exercises the FTS-floor path (embedded Postgres has
// no pgvector, decision #2): migrate -> capability probe -> index ->
// hybrid search -> graph traversal -> provider remember/recall/forget.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDbConfig } from "./_helpers.js";
import { createLocalStorage } from "@boringos/drive";
import {
  createIndexer,
  createGraphReader,
  searchHybrid,
  probeCapabilities,
  __resetCapabilityCache,
  nullEmbedder,
  createBrainMemory,
  dailyDateStamp,
  parseDailyFragments,
  renderFragmentBlock,
} from "@boringos/brain";
import type { Db } from "@boringos/db";

const TENANT = "11111111-1111-1111-1111-1111111111aa";

describe("brain — integration (FTS floor)", () => {
  let dataDir: string;
  let driveDir: string;
  let dbConn: { db: Db; close: () => Promise<void> };
  let db: Db;
  let drive: ReturnType<typeof createLocalStorage>;

  beforeAll(async () => {
    __resetCapabilityCache();
    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "brain-it-pg-"));
    driveDir = await mkdtemp(join(tmpdir(), "brain-it-drive-"));
    dbConn = (await createDatabase(testDbConfig(dataDir, 5607))) as typeof dbConn;
    db = dbConn.db;
    const migrator = createMigrationManager(db as never);
    await migrator.apply();
    // brain__memories.tenant_id FKs to tenants(id) — seed one.
    await db.execute(sql`
      INSERT INTO tenants (id, name, slug)
      VALUES (${TENANT}::uuid, 'Brain Test', 'brain-test')
      ON CONFLICT (id) DO NOTHING
    `);
    drive = createLocalStorage({ root: driveDir });
  }, 90_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(driveDir, { recursive: true, force: true });
  });

  it("the embedded Postgres degrades to the FTS floor (no pgvector)", async () => {
    const caps = await probeCapabilities(db);
    expect(caps.hasVector).toBe(false); // embedded distro ships no pgvector
    expect(caps.hasTrgm).toBe(true); // but it does ship pg_trgm
  });

  it("indexes content and finds it via FTS hybrid search", async () => {
    const indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
    await indexer.index({
      tenantId: TENANT,
      sourceKind: "manual",
      sourceRef: "shared/memory/notes/pricing.md",
      content:
        "We decided the enterprise plan is priced at $2000 per seat per year for [[Acme Corp]].",
    });

    const hits = await searchHybrid(db, nullEmbedder, false, {
      tenantId: TENANT,
      query: "enterprise pricing plan",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain("enterprise plan");
    expect(hits[0].sourceRef).toBe("shared/memory/notes/pricing.md");
  });

  it("auto-wires a [[wikilink]] into the typed graph (zero LLM)", async () => {
    const reader = createGraphReader(db);
    // The pricing.md indexed above mentions [[Acme Corp]].
    const out = await reader.traverse({
      tenantId: TENANT,
      type: "source",
      id: "shared/memory/notes/pricing.md",
      depth: 1,
    });
    const topics = out.edges.filter((e) => e.edgeType === "mentions" && e.dstType === "topic");
    expect(topics.some((e) => e.dstId === "acme-corp")).toBe(true);
  });

  it("replace-on-reindex does not duplicate rows", async () => {
    const indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
    const ref = "shared/memory/notes/dup.md";
    await indexer.index({ tenantId: TENANT, sourceKind: "manual", sourceRef: ref, content: "first version about onboarding" });
    await indexer.index({ tenantId: TENANT, sourceKind: "manual", sourceRef: ref, content: "second version about onboarding" });

    const live = (await db.execute(sql`
      SELECT content FROM brain__memories
      WHERE tenant_id = ${TENANT}::uuid AND source_ref = ${ref} AND deleted_at IS NULL
    `)) as unknown as Array<{ content: string }>;
    expect(live).toHaveLength(1);
    expect(live[0].content).toContain("second version");
  });

  it("provider remember -> recall -> forget round-trips (file = SoR + mirror)", async () => {
    const memory = createBrainMemory({ drive, db, embedder: nullEmbedder });

    const id = await memory.remember(
      "Vendor Globex invoices monthly on net-30 terms.",
      { tenantId: TENANT, scope: "tenant" },
    );
    // v2: the id is a daily-note fragment ref `<dailyPath>#<subid>`.
    const date = dailyDateStamp(new Date());
    expect(id).toMatch(new RegExp(`^shared/memory/60-daily/${date}\\.md#[0-9a-f]{8}$`));
    // The daily note (without the #fragment suffix) is the system of record.
    const dailyPath = id.split("#")[0];
    expect(await drive.exists(`${TENANT}/${dailyPath}`)).toBe(true);

    // Mirror is queryable via hybrid recall.
    const recalled = await memory.recall("Globex net-30 invoice terms", {
      tenantId: TENANT,
      scope: "tenant",
    });
    expect(recalled.some((r) => r.content.includes("Globex"))).toBe(true);

    // Forget strikes the fragment from the file + soft-deletes the mirror.
    await memory.forget(`${TENANT}/${id}`);
    const after = await memory.recall("Globex net-30 invoice terms", {
      tenantId: TENANT,
      scope: "tenant",
    });
    expect(after.some((r) => r.content.includes("Globex"))).toBe(false);
    // The daily note survives (other facts may live there); the Globex
    // block is gone from it.
    const fileAfter = await drive.readText(`${TENANT}/${dailyPath}`);
    expect(fileAfter).not.toContain("Globex");
  });

  it("brain.query read-only transaction rejects writes", async () => {
    // Direct probe of the read-only enforcement the brain.query tool
    // relies on: a write inside a READ ONLY transaction must error.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
        await tx.execute(
          sql.raw(
            `INSERT INTO brain__memories (tenant_id, source_kind, content) VALUES ('${TENANT}', 'manual', 'should fail')`,
          ),
        );
      }),
    ).rejects.toThrow(/read-only/i);
  });

  it("brain.query SET LOCAL statement_timeout actually kills a long query", async () => {
    // Proves the statement_timeout the brain.query tool sets is enforced
    // for the user query in the SAME transaction (SET LOCAL applies for
    // the remainder of the transaction, not just the next statement).
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
        await tx.execute(sql.raw("SET LOCAL statement_timeout = '300ms'"));
        await tx.execute(sql.raw("SELECT pg_sleep(3)"));
      }),
    ).rejects.toThrow(/statement timeout|canceling statement/i);
  });

  it("re-indexing identical content is a no-op (no double work / double embed)", async () => {
    const indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
    const ref = "shared/memory/notes/idem.md";
    const content = "Stable fact about the renewal date for [[Initech]].";
    const ids1 = await indexer.index({ tenantId: TENANT, sourceKind: "manual", sourceRef: ref, content });
    // Second index with identical content — the provider remember() +
    // post-run reindex overlap that finding #5 was about.
    const ids2 = await indexer.index({ tenantId: TENANT, sourceKind: "file", sourceRef: ref, content });
    // Same row ids returned (short-circuit), not a fresh insert.
    expect(ids2).toEqual(ids1);
    const live = (await db.execute(sql`
      SELECT id FROM brain__memories
      WHERE tenant_id = ${TENANT}::uuid AND source_ref = ${ref} AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string }>;
    expect(live).toHaveLength(ids1.length);
    // Changed content DOES re-index.
    const ids3 = await indexer.index({ tenantId: TENANT, sourceKind: "file", sourceRef: ref, content: content + " Updated." });
    expect(ids3).not.toEqual(ids1);
  });

  // ── Memory tree v2 — canonical layout + write routing (Unit 1) ──────

  it("remember() appends a fragment to today's 60-daily note + is recallable", async () => {
    const memory = createBrainMemory({ drive, db, embedder: nullEmbedder });
    const date = dailyDateStamp(new Date());
    const id = await memory.remember("Umbrella Corp renews in [[March]] on net-45 terms.", {
      tenantId: TENANT,
      scope: "tenant",
    });
    // Id is a fragment ref: <dailyPath>#<subid>.
    expect(id).toMatch(new RegExp(`^shared/memory/60-daily/${date}\\.md#[0-9a-f]{8}$`));
    // The daily file exists with the header + an invisible frag marker.
    const file = await drive.readText(`${TENANT}/shared/memory/60-daily/${date}.md`);
    expect(file).toContain(`# ${date}`);
    expect(file).toContain("<!-- frag mem");
    expect(file).toContain("Umbrella Corp");
    // And it's recallable via the mirror.
    const recalled = await memory.recall("Umbrella net-45 renewal", { tenantId: TENANT, scope: "tenant" });
    expect(recalled.some((r) => r.content.includes("Umbrella"))).toBe(true);
  });

  it("two remembers the same day land in ONE file as TWO fragments", async () => {
    const memory = createBrainMemory({ drive, db, embedder: nullEmbedder });
    const id1 = await memory.remember("Initech fact ALPHA about [[Widgets]].", { tenantId: TENANT, scope: "tenant" });
    const id2 = await memory.remember("Initech fact BETA about [[Widgets]].", { tenantId: TENANT, scope: "tenant" });
    // Same daily file path, distinct fragment ids.
    expect(id1.split("#")[0]).toBe(id2.split("#")[0]);
    expect(id1).not.toBe(id2);
    const frags = parseDailyFragments(await drive.readText(`${TENANT}/${id1.split("#")[0]}`));
    expect(frags.filter((f) => f.body.includes("Initech fact")).length).toBeGreaterThanOrEqual(2);
    const r = await memory.recall("Initech Widgets fact", { tenantId: TENANT, scope: "tenant" });
    expect(r.some((x) => x.content.includes("ALPHA"))).toBe(true);
    expect(r.some((x) => x.content.includes("BETA"))).toBe(true);
  });

  it("forget(fragmentId) strikes just that block — siblings survive", async () => {
    const memory = createBrainMemory({ drive, db, embedder: nullEmbedder });
    const idA = await memory.remember("Cyberdyne fact KEEPME.", { tenantId: TENANT, scope: "tenant" });
    const idB = await memory.remember("Cyberdyne fact DROPME.", { tenantId: TENANT, scope: "tenant" });
    expect(idA.split("#")[0]).toBe(idB.split("#")[0]);

    await memory.forget(`${TENANT}/${idB}`);

    // The dropped fragment is gone from the file; the kept one remains.
    const file = await drive.readText(`${TENANT}/${idA.split("#")[0]}`);
    expect(file).toContain("KEEPME");
    expect(file).not.toContain("DROPME");
    // And gone from the mirror; sibling still recalled.
    const r = await memory.recall("Cyberdyne fact", { tenantId: TENANT, scope: "tenant" });
    expect(r.some((x) => x.content.includes("KEEPME"))).toBe(true);
    expect(r.some((x) => x.content.includes("DROPME"))).toBe(false);
  });

  it("indexMemoryFile GCs fragments that disappear from a daily note", async () => {
    const indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
    const dpath = "shared/memory/60-daily/2099-01-01.md";
    const two =
      renderFragmentBlock({ kind: "mem", subid: "frag0001", ts: "t1", body: "alpha gamma content" }) +
      "\n" +
      renderFragmentBlock({ kind: "mem", subid: "frag0002", ts: "t2", body: "beta delta content" });
    await indexer.indexMemoryFile({ tenantId: TENANT, path: dpath, content: two });
    const liveCount = async () =>
      (
        (await db.execute(sql`
          SELECT source_ref FROM brain__memories
          WHERE tenant_id = ${TENANT}::uuid AND starts_with(source_ref, ${dpath + "#"}) AND deleted_at IS NULL
        `)) as unknown as Array<{ source_ref: string }>
      );
    expect((await liveCount()).length).toBe(2);

    // Re-index with frag0002 removed → it's GC'd, frag0001 survives.
    const one = renderFragmentBlock({ kind: "mem", subid: "frag0001", ts: "t1", body: "alpha gamma content" });
    await indexer.indexMemoryFile({ tenantId: TENANT, path: dpath, content: one });
    const remaining = await liveCount();
    expect(remaining.length).toBe(1);
    expect(remaining[0].source_ref).toBe(`${dpath}#frag0001`);
  });

  it("indexMemoryFile whole-files a NON-daily memory file (no fragments)", async () => {
    const indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
    const p = "shared/memory/20-decisions/discount-policy.md";
    await indexer.indexMemoryFile({
      tenantId: TENANT,
      path: p,
      content: "Policy: we discount [[Enterprise]] renewals by twenty percent.",
    });
    const hits = await searchHybrid(db, nullEmbedder, false, {
      tenantId: TENANT,
      query: "enterprise discount renewal policy",
    });
    // Whole-file source_ref — the bare path, no '#fragment'.
    expect(hits.some((h) => h.sourceRef === p)).toBe(true);
  });
});

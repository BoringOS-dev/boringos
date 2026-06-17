// Brain ⇄ OKF compatibility (docs/brain-okf-compat.md). Units: frontmatter
// + citation parsing. Integration (real PG + drive): type→kind, distill
// frontmatter, conformance back-fill, per-dir index.md + okf_version,
// export conformance. Plus the headline end-to-end: ~5 FAKED inbox emails
// → remembered facts citing them → distill → curate → export, asserting
// OKF §9 conformance + retrieval + (src:)/cites provenance to the emails.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDbConfig } from "./_helpers.js";
import { createLocalStorage } from "@boringos/drive";
import {
  renderFrontmatter,
  parseFrontmatter,
  hasConformantFrontmatter,
  extractCitations,
  createIndexer,
  createBrainMemory,
  distill,
  curate,
  exportOkf,
  searchHybrid,
  isoWeekId,
  nullEmbedder,
  __resetCapabilityCache,
} from "@boringos/brain";
import type { Db, DatabaseConnection } from "@boringos/db";

const TENANT = "44444444-4444-4444-4444-4444444444dd";

describe("brain — OKF units", () => {
  it("frontmatter round-trips (type required + recommended fields)", () => {
    const doc = renderFrontmatter({ type: "domain", title: "Acme Corp", resource: "topic:acme-corp", tags: ["vendor"] }) + "\n# Acme Corp\n\nbody";
    expect(hasConformantFrontmatter(doc)).toBe(true);
    const { fm, body } = parseFrontmatter(doc);
    expect(fm.type).toBe("domain");
    expect(fm.title).toBe("Acme Corp");
    expect(fm.resource).toBe("topic:acme-corp");
    expect(fm.tags).toEqual(["vendor"]);
    expect(body.trim()).toBe("# Acme Corp\n\nbody");
  });

  it("hasConformantFrontmatter is false without a type", () => {
    expect(hasConformantFrontmatter("# No frontmatter\n")).toBe(false);
    expect(hasConformantFrontmatter("---\ntitle: x\n---\nbody")).toBe(false); // no type
  });

  it("extractCitations parses inline (src:), # Citations links, urls, rows", () => {
    const c1 = extractCitations("Fact (src: inbox_items:e1).");
    expect(c1.map((c) => `${c.dstType}:${c.dstId}`)).toContain("row:inbox_items:e1");
    const c2 = extractCitations("Body.\n\n# Citations\n\n[1] [src](/10-domains/acme.md)\n[2] [ext](https://x.test/a)\n");
    const ids = c2.map((c) => `${c.dstType}:${c.dstId}`);
    expect(ids).toContain("memory:10-domains/acme.md");
    expect(ids).toContain("url:https://x.test/a");
  });
});

describe("brain — OKF integration", () => {
  let dataDir: string;
  let driveDir: string;
  let dbConn: DatabaseConnection;
  let db: Db;
  let drive: ReturnType<typeof createLocalStorage>;
  let indexer: ReturnType<typeof createIndexer>;

  const read = (rel: string) => drive.readText(`${TENANT}/${rel}`).catch(() => null);
  const exists = (rel: string) => drive.exists(`${TENANT}/${rel}`);

  beforeAll(async () => {
    __resetCapabilityCache();
    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "brain-okf-pg-"));
    driveDir = await mkdtemp(join(tmpdir(), "brain-okf-drive-"));
    dbConn = (await createDatabase(testDbConfig(dataDir, 5623))) as DatabaseConnection;
    db = dbConn.db;
    await createMigrationManager(db as never).apply();
    await db.execute(sql`INSERT INTO tenants (id, name, slug) VALUES (${TENANT}::uuid, 'OKF Test', 'okf-test') ON CONFLICT (id) DO NOTHING`);
    drive = createLocalStorage({ root: driveDir });
    indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
  }, 90_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(driveDir, { recursive: true, force: true });
  });

  it("indexer reads frontmatter type→kind and resource→describes edge", async () => {
    const doc = renderFrontmatter({ type: "domain", title: "Globex", resource: "topic:globex" }) + "\n# Globex\n\nGlobex is a [[partner]].\n";
    await drive.write(`${TENANT}/shared/memory/10-domains/globex.md`, doc);
    await indexer.indexMemoryFile({ tenantId: TENANT, path: "shared/memory/10-domains/globex.md", content: doc, scope: "tenant" });
    const rows = (await db.execute(sql`
      SELECT kind FROM brain__memories WHERE tenant_id=${TENANT}::uuid AND source_ref='shared/memory/10-domains/globex.md' AND deleted_at IS NULL
    `)) as unknown as Array<{ kind: string }>;
    expect(rows[0]?.kind).toBe("domain");
    const edges = (await db.execute(sql`
      SELECT dst_type, dst_id FROM brain__edges WHERE tenant_id=${TENANT}::uuid AND edge_type='describes' AND deleted_at IS NULL
    `)) as unknown as Array<{ dst_type: string; dst_id: string }>;
    expect(edges.some((e) => e.dst_type === "resource" && e.dst_id === "topic:globex")).toBe(true);
  });

  it("curate back-fills frontmatter, writes per-dir index.md + okf_version", async () => {
    // A non-conformant concept (no frontmatter).
    await drive.write(`${TENANT}/shared/memory/40-operations/runbook.md`, "# Deploy runbook\n\nStep 1. push.\n");
    const r = await curate({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now: new Date("2026-06-15T12:00:00Z") });
    expect(r.conformanceFixed).toBeGreaterThanOrEqual(1);
    expect(hasConformantFrontmatter((await read("shared/memory/40-operations/runbook.md"))!)).toBe(true);
    // per-dir index.md (no frontmatter, OKF list form)
    expect(await exists("shared/memory/40-operations/index.md")).toBe(true);
    const idx = (await read("shared/memory/40-operations/index.md"))!;
    expect(hasConformantFrontmatter(idx)).toBe(false); // index files carry no frontmatter
    expect(idx).toMatch(/^\*\s+\[.+\]\(.+\.md\)/m);
    // root okf_version
    expect((await read("shared/memory/index.md"))!).toContain("okf_version: 0.1");
  });

  it("export_okf reports a conformant bundle", async () => {
    const exp = await exportOkf({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now: new Date("2026-06-15T12:00:00Z") });
    expect(exp.okfVersion).toBe("0.1");
    expect(exp.violations).toEqual([]);
    expect(exp.conformant).toBe(true);
    expect(exp.fileCount).toBeGreaterThan(0);
  });

  it("END-TO-END: ~5 faked emails → remember → distill → curate → export, OKF-conformant + cited", async () => {
    // 1. Fake 5 inbound emails as inbox_items + index them as row pointers.
    const emails = [
      { id: "eml-1", subj: "Acme renewal terms", from: "ops@acme.test", body: "Acme will renew on net-30 in October." },
      { id: "eml-2", subj: "Globex outage postmortem", from: "sre@globex.test", body: "Globex had a Q3 outage; RCA attached." },
      { id: "eml-3", subj: "Initech invoice", from: "ar@initech.test", body: "Initech invoice #88 due net-45." },
      { id: "eml-4", subj: "Umbrella security review", from: "sec@umbrella.test", body: "Umbrella passed SOC2 Type II." },
      { id: "eml-5", subj: "Soylent partnership", from: "bd@soylent.test", body: "Soylent proposes a co-marketing deal." },
    ];
    // inbox_items.id is UUID (DB-generated); map our source_id → the uuid.
    const idMap = new Map<string, string>();
    for (const e of emails) {
      const rows = (await db.execute(sql`
        INSERT INTO inbox_items (tenant_id, source, source_id, subject, body, "from", status)
        VALUES (${TENANT}::uuid, 'gmail', ${e.id}, ${e.subj}, ${e.body}, ${e.from}, 'unread')
        RETURNING id::text AS id
      `)) as unknown as Array<{ id: string }>;
      idMap.set(e.id, rows[0].id);
      // Index the email as a row pointer (decision #11) — retrievable, no copy.
      await indexer.indexRowPointer({ tenantId: TENANT, table: "inbox_items", rowId: rows[0].id, snippet: `${e.subj} — ${e.body}` });
    }

    // 2. Remember a fact per email (what a triage agent would distill),
    //    citing the email row via (src: inbox_items:<uuid>) + a wikilink.
    const memory = createBrainMemory({ drive, db, embedder: nullEmbedder });
    const facts: Array<[string, string]> = [
      ["Acme Corp", `[[Acme Corp]] will renew on net-30 in October. (src: inbox_items:${idMap.get("eml-1")})`],
      ["Globex", `[[Globex]] had a Q3 outage with an RCA. (src: inbox_items:${idMap.get("eml-2")})`],
      ["Initech", `[[Initech]] invoice 88 is due net-45. (src: inbox_items:${idMap.get("eml-3")})`],
      ["Umbrella", `[[Umbrella]] passed SOC2 Type II. (src: inbox_items:${idMap.get("eml-4")})`],
      ["Soylent", `[[Soylent]] proposed a co-marketing deal. (src: inbox_items:${idMap.get("eml-5")})`],
    ];
    for (const [, f] of facts) await memory.remember(f, { tenantId: TENANT, scope: "tenant" });

    // 3. Distill → 4. Curate → 5. Export. Use the REAL clock: remember()
    // stamps today's daily note, so distill's window must include today.
    const now = new Date();
    await distill({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now, windowDays: 30 });
    await curate({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now });
    const exp = await exportOkf({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now });

    // OKF-§9 conformant bundle.
    expect(exp.conformant).toBe(true);
    expect(exp.violations).toEqual([]);
    expect(exp.okfVersion).toBe("0.1");

    // Emailed facts retrievable.
    const acme = await searchHybrid(db, nullEmbedder, false, { tenantId: TENANT, query: "Acme renew October net-30" });
    expect(acme.some((h) => h.content.includes("Acme Corp") || h.content.toLowerCase().includes("renew"))).toBe(true);
    // The email itself is retrievable as a row pointer.
    const outage = await searchHybrid(db, nullEmbedder, false, { tenantId: TENANT, query: "Globex outage postmortem" });
    expect(outage.some((h) => h.sourceKind === "row" && (h.sourceRef ?? "").startsWith("inbox_items:"))).toBe(true);

    // (src:)/cites provenance chains back to the emails.
    const citeEdges = (await db.execute(sql`
      SELECT dst_id FROM brain__edges
      WHERE tenant_id=${TENANT}::uuid AND edge_type='cites' AND dst_type='row'
        AND dst_id LIKE 'inbox_items:%' AND deleted_at IS NULL
    `)) as unknown as Array<{ dst_id: string }>;
    expect(citeEdges.length).toBeGreaterThanOrEqual(3);

    // The promoted domain files carry OKF frontmatter.
    const week = isoWeekId(now);
    void week;
    const acmeDoc = await read("shared/memory/10-domains/acme-corp.md");
    expect(acmeDoc != null && hasConformantFrontmatter(acmeDoc)).toBe(true);
  });
});

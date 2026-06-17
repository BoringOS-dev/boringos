// Operational data as OKF (docs/brain-okf-compat.md). Real PG + drive:
// materialize OKF type:table schema docs from the LIVE schema (core
// operational tables + a synthetic demo__widgets module table), ingest
// rows as pointers, and assert the docs are conformant + correct-columns
// + findable and the rows are retrievable + column-queryable.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDbConfig } from "./_helpers.js";
import { createLocalStorage } from "@boringos/drive";
import {
  createIndexer,
  materializeSchemaDocs,
  ingestRows,
  discoverTables,
  introspectColumns,
  searchHybrid,
  hasConformantFrontmatter,
  parseFrontmatter,
  nullEmbedder,
  __resetCapabilityCache,
} from "@boringos/brain";
import type { Db, DatabaseConnection } from "@boringos/db";

const TENANT = "55555555-5555-5555-5555-5555555555ee";

describe("brain — operational data as OKF", () => {
  let dataDir: string;
  let driveDir: string;
  let dbConn: DatabaseConnection;
  let db: Db;
  let drive: ReturnType<typeof createLocalStorage>;
  let indexer: ReturnType<typeof createIndexer>;
  const read = (rel: string) => drive.readText(`${TENANT}/${rel}`).catch(() => null);

  beforeAll(async () => {
    __resetCapabilityCache();
    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "brain-opdata-pg-"));
    driveDir = await mkdtemp(join(tmpdir(), "brain-opdata-drive-"));
    dbConn = (await createDatabase(testDbConfig(dataDir, 5627))) as DatabaseConnection;
    db = dbConn.db;
    await createMigrationManager(db as never).apply();
    await db.execute(sql`INSERT INTO tenants (id, name, slug) VALUES (${TENANT}::uuid, 'OpData Test', 'opdata-test') ON CONFLICT (id) DO NOTHING`);
    // A synthetic module table (the <module>__* convention).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS demo__widgets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    drive = createLocalStorage({ root: driveDir });
    indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
  }, 90_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(driveDir, { recursive: true, force: true });
  });

  it("discoverTables finds core operational + <module>__* tables", async () => {
    const tables = await discoverTables(db);
    expect(tables).toContain("inbox_items");
    expect(tables).toContain("tasks");
    expect(tables).toContain("task_comments");
    expect(tables).toContain("agent_runs");
    expect(tables).toContain("demo__widgets");
  });

  it("introspectColumns reads live columns (incl. the module table)", async () => {
    const cols = (await introspectColumns(db, "demo__widgets")).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "tenant_id", "name", "description", "created_at"]));
  });

  it("materializeSchemaDocs writes OKF type:table docs with correct columns + enrichment", async () => {
    const res = await materializeSchemaDocs(
      { db, drive, indexer },
      {
        tenantId: TENANT,
        scope: "tenant",
        now: new Date("2026-06-17T12:00:00Z"),
        enrich: {
          demo__widgets: {
            table: "demo__widgets",
            description: "Demo widgets owned by the demo module.",
            columns: [{ name: "name", description: "the widget's display name" }],
          },
        },
      },
    );
    expect(res.tables).toContain("demo__widgets");
    expect(res.tables).toContain("inbox_items");

    const doc = await read("shared/memory/50-schema/demo__widgets.md");
    expect(doc).not.toBeNull();
    // OKF conformant, type: table.
    expect(hasConformantFrontmatter(doc!)).toBe(true);
    expect(parseFrontmatter(doc!).fm.type).toBe("table");
    expect(parseFrontmatter(doc!).fm.resource).toBe("table:demo__widgets");
    // # Schema lists the live columns + the enrichment description.
    expect(doc).toContain("# Schema");
    expect(doc).toContain("| name |");
    expect(doc).toContain("the widget's display name");
    expect(doc).toContain("| description |");
    // Indexed into the brain with kind 'table'.
    const rows = (await db.execute(sql`
      SELECT kind FROM brain__memories WHERE tenant_id=${TENANT}::uuid AND source_ref='shared/memory/50-schema/demo__widgets.md' AND deleted_at IS NULL
    `)) as unknown as Array<{ kind: string }>;
    expect(rows[0]?.kind).toBe("table");
    // Findable.
    const hits = await searchHybrid(db, nullEmbedder, false, { tenantId: TENANT, query: "demo module widgets schema" });
    expect(hits.some((h) => h.sourceRef === "shared/memory/50-schema/demo__widgets.md")).toBe(true);
  });

  it("ingestRows indexes operational + module rows as findable pointers", async () => {
    // Seed an email + two widgets.
    await db.execute(sql`
      INSERT INTO inbox_items (tenant_id, source, source_id, subject, body, "from", status)
      VALUES (${TENANT}::uuid, 'gmail', 'opd-1', 'Quarterly review with Globex', 'Globex wants a QBR next week.', 'ops@globex.test', 'unread')`);
    await db.execute(sql`INSERT INTO demo__widgets (tenant_id, name, description) VALUES (${TENANT}::uuid, 'Sprocket 9000', 'A blue industrial sprocket.')`);
    await db.execute(sql`INSERT INTO demo__widgets (tenant_id, name, description) VALUES (${TENANT}::uuid, 'Cog Mini', 'A small brass cog.')`);

    const res = await ingestRows({ db, drive, indexer }, { tenantId: TENANT, now: new Date(), limit: 100 });
    expect((res.byTable["demo__widgets"] ?? 0)).toBeGreaterThanOrEqual(2);
    expect((res.byTable["inbox_items"] ?? 0)).toBeGreaterThanOrEqual(1);

    // The module row is findable as a pointer (by reference).
    const w = await searchHybrid(db, nullEmbedder, false, { tenantId: TENANT, query: "blue industrial sprocket" });
    expect(w.some((h) => h.sourceKind === "row" && (h.sourceRef ?? "").startsWith("demo__widgets:"))).toBe(true);
    // The email row is findable as a pointer.
    const e = await searchHybrid(db, nullEmbedder, false, { tenantId: TENANT, query: "Globex quarterly review QBR" });
    expect(e.some((h) => h.sourceKind === "row" && (h.sourceRef ?? "").startsWith("inbox_items:"))).toBe(true);
    // Doesn't index the brain's own tables into itself.
    expect(Object.keys(res.byTable).some((t) => t.startsWith("brain__"))).toBe(false);
  });

  it("the schema doc enables a correct column-level query (read-only)", async () => {
    // Using the column the schema doc documents (`name`), a tenant-scoped
    // read-only query returns the seeded widgets — proving the catalog is
    // accurate enough to write SQL against.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
      return (await tx.execute(sql`
        SELECT name FROM demo__widgets WHERE tenant_id = ${TENANT}::uuid ORDER BY name
      `)) as unknown as Array<{ name: string }>;
    });
    expect(rows.map((r) => r.name)).toEqual(["Cog Mini", "Sprocket 9000"]);
  });

  it("re-running sync + ingest is idempotent", async () => {
    // Warm call (test 3 enriched demo__widgets; a no-enrich call rewrites it once).
    await materializeSchemaDocs({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now: new Date("2026-06-17T13:00:00Z") });
    // A second identical call rewrites nothing (idempotent on body).
    const r2 = await materializeSchemaDocs({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now: new Date("2026-06-17T13:05:00Z") });
    expect(r2.written).toBe(0);
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM brain__memories WHERE tenant_id=${TENANT}::uuid AND source_kind='row' AND deleted_at IS NULL`)) as unknown as Array<{ n: number }>;
    await ingestRows({ db, drive, indexer }, { tenantId: TENANT, now: new Date(), limit: 100 });
    const after = (await db.execute(sql`SELECT count(*)::int AS n FROM brain__memories WHERE tenant_id=${TENANT}::uuid AND source_kind='row' AND deleted_at IS NULL`)) as unknown as Array<{ n: number }>;
    expect(after[0].n).toBe(before[0].n); // replace-on-reindex, no duplication
  });
});

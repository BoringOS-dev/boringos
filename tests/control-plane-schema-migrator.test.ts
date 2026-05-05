/**
 * K2 — schema migration runner.
 *
 * Verifies migrations apply in lex order, skip already-applied,
 * roll back inside a failing transaction, and create app-namespaced
 * tables (which a hard uninstall could later DROP).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import {
  createDrizzleInstallDb,
  runAppMigrations,
  SchemaMigratorError,
} from "@boringos/control-plane";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k2-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5597,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K2 Test', 'k2-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): { bundleDir: string; schemaRel: string } {
  const bundleDir = mkdtempSync(join(tmpdir(), "bos-k2-fixture-"));
  const schemaDir = join(bundleDir, "schema");
  mkdirSync(schemaDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(schemaDir, name), content, "utf8");
  }
  return { bundleDir, schemaRel: "schema" };
}

async function tableExists(db: any, name: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT to_regclass(${name}) AS oid
  `)) as Array<{ oid: string | null }>;
  return rows[0]?.oid !== null;
}

describe("runAppMigrations", () => {
  it("applies SQL files in lex order, creates app-namespaced tables", async () => {
    const { bundleDir, schemaRel } = makeFixture({
      "001_init.sql": `CREATE TABLE k2_app_a_thing (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          label TEXT NOT NULL
        )`,
      "002_index.sql": `CREATE INDEX k2_app_a_thing_label_idx ON k2_app_a_thing(label)`,
    });

    const adapter = createDrizzleInstallDb(conn.db);

    const result = await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-a", schema: schemaRel },
        bundleDir,
      }),
    );

    expect(result.appliedFiles).toEqual(["001_init.sql", "002_index.sql"]);
    expect(result.skippedFiles).toEqual([]);
    expect(await tableExists(conn.db, "k2_app_a_thing")).toBe(true);

    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("re-running skips already-applied migrations", async () => {
    const { bundleDir, schemaRel } = makeFixture({
      "001_init.sql": `CREATE TABLE k2_app_b_thing (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
    });

    const adapter = createDrizzleInstallDb(conn.db);

    const first = await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-b", schema: schemaRel },
        bundleDir,
      }),
    );
    expect(first.appliedFiles).toEqual(["001_init.sql"]);

    const second = await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-b", schema: schemaRel },
        bundleDir,
      }),
    );
    expect(second.appliedFiles).toEqual([]);
    expect(second.skippedFiles).toEqual(["001_init.sql"]);

    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("a failing migration rolls back the whole install transaction", async () => {
    const { bundleDir, schemaRel } = makeFixture({
      "001_ok.sql": `CREATE TABLE k2_app_c_thing (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
      "002_bad.sql": `THIS IS NOT VALID SQL`,
    });

    const adapter = createDrizzleInstallDb(conn.db);

    await expect(
      adapter.transaction(async (_db, tx) =>
        runAppMigrations(tx, {
          tenantId,
          app: { id: "k2-app-c", schema: schemaRel },
          bundleDir,
        }),
      ),
    ).rejects.toBeInstanceOf(SchemaMigratorError);

    // 001's CREATE TABLE rolled back along with the failed 002.
    expect(await tableExists(conn.db, "k2_app_c_thing")).toBe(false);

    // No migrations recorded for k2-app-c.
    const recorded = (await conn.db.execute(sql`
      SELECT filename FROM tenant_app_migrations
      WHERE tenant_id = ${tenantId} AND app_id = 'k2-app-c'
    `)) as Array<{ filename: string }>;
    expect(recorded).toEqual([]);

    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("hard uninstall (DROP TABLE) cleans up app-owned tables created by migrations", async () => {
    // Verifies the contract that migrations can be reversed via drop —
    // K2 owns creation, K6/uninstall owns teardown. The runner only needs
    // to leave a discoverable artifact (the namespaced table).
    const { bundleDir, schemaRel } = makeFixture({
      "001_init.sql": `CREATE TABLE k2_app_d_thing (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`,
    });
    const adapter = createDrizzleInstallDb(conn.db);

    await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-d", schema: schemaRel },
        bundleDir,
      }),
    );
    expect(await tableExists(conn.db, "k2_app_d_thing")).toBe(true);

    // Simulate hard uninstall (caller — uninstall pipeline — would do
    // this; the migrator just leaves the artifacts in a known shape).
    await conn.db.execute(sql`DROP TABLE k2_app_d_thing`);
    await conn.db.execute(sql`
      DELETE FROM tenant_app_migrations
      WHERE tenant_id = ${tenantId} AND app_id = 'k2-app-d'
    `);

    expect(await tableExists(conn.db, "k2_app_d_thing")).toBe(false);

    // Migrator can now re-apply the same files cleanly.
    const result = await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-d", schema: schemaRel },
        bundleDir,
      }),
    );
    expect(result.appliedFiles).toEqual(["001_init.sql"]);
    expect(await tableExists(conn.db, "k2_app_d_thing")).toBe(true);

    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("apps without a schema entry are a no-op", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const result = await adapter.transaction(async (_db, tx) =>
      runAppMigrations(tx, {
        tenantId,
        app: { id: "k2-app-noschema" },
      }),
    );
    expect(result).toEqual({ appliedFiles: [], skippedFiles: [] });
  });

  it("missing schema directory is reported as a packaging error", async () => {
    const bundleDir = mkdtempSync(join(tmpdir(), "bos-k2-empty-"));
    const adapter = createDrizzleInstallDb(conn.db);
    await expect(
      adapter.transaction(async (_db, tx) =>
        runAppMigrations(tx, {
          tenantId,
          app: { id: "k2-app-missing", schema: "schema" },
          bundleDir,
        }),
      ),
    ).rejects.toBeInstanceOf(SchemaMigratorError);
    rmSync(bundleDir, { recursive: true, force: true });
  });
});

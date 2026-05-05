/**
 * K1 — Drizzle InstallPipelineDb adapter (integration test against
 * embedded Postgres).
 *
 * Verifies that the adapter writes/reads/deletes against the real
 * tenant_apps table and that the transaction helper rolls back on error.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import {
  createDrizzleInstallDb,
  installApp,
  type InstallContext,
  type TenantAppRow,
} from "@boringos/control-plane";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

const validAppManifest = {
  kind: "app" as const,
  id: "crm",
  version: "1.0.0",
  name: "CRM",
  description: "Test CRM manifest",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [{ id: "crm_contact", label: "Contact" }],
  ui: { entry: "dist/ui.js" },
  capabilities: ["entities.own:write", "slots:nav"],
};

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k1-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5598,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K1 Test', 'k1-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("createDrizzleInstallDb — integration", () => {
  it("insert + get + delete hit the real tenant_apps table", async () => {
    const adapter = createDrizzleInstallDb(conn.db);

    const row: TenantAppRow = {
      tenantId,
      appId: "test-app-1",
      version: "1.2.3",
      status: "active",
      capabilities: ["entities.own:write"],
      manifestHash: "deadbeef",
    };

    expect(await adapter.getTenantApp!(tenantId, "test-app-1")).toBeNull();

    await adapter.insertTenantApp(row);

    const fetched = await adapter.getTenantApp!(tenantId, "test-app-1");
    expect(fetched).toMatchObject({
      tenantId,
      appId: "test-app-1",
      version: "1.2.3",
      status: "active",
      capabilities: ["entities.own:write"],
      manifestHash: "deadbeef",
    });
    expect(fetched?.id).toBeTruthy();

    await adapter.deleteTenantApp(tenantId, "test-app-1");
    expect(await adapter.getTenantApp!(tenantId, "test-app-1")).toBeNull();
  });

  it("install + uninstall end-to-end leaves row count consistent", async () => {
    const adapter = createDrizzleInstallDb(conn.db);

    const before = await rowCount(conn.db, tenantId);

    const ctx: InstallContext = {
      db: adapter,
      slotRuntime: {
        installApp: ({ appId }) => ({ appId }),
        uninstallApp: () => {},
      },
      events: { emit: () => {} },
    };

    await installApp(ctx, {
      manifest: { ...validAppManifest, id: "e2e-app" },
      tenantId,
      manifestHash: "h1",
    });

    expect(await rowCount(conn.db, tenantId)).toBe(before + 1);

    await adapter.deleteTenantApp(tenantId, "e2e-app");

    expect(await rowCount(conn.db, tenantId)).toBe(before);
  });

  it("transaction rolls back when callback throws", async () => {
    const adapter = createDrizzleInstallDb(conn.db);

    const before = await rowCount(conn.db, tenantId);

    await expect(
      adapter.transaction(async (txDb) => {
        await txDb.insertTenantApp({
          tenantId,
          appId: "tx-rollback",
          version: "0.0.1",
          status: "active",
          capabilities: [],
          manifestHash: null,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await rowCount(conn.db, tenantId)).toBe(before);
    expect(await adapter.getTenantApp!(tenantId, "tx-rollback")).toBeNull();
  });

  it("transaction commits when callback resolves", async () => {
    const adapter = createDrizzleInstallDb(conn.db);

    await adapter.transaction(async (txDb) => {
      await txDb.insertTenantApp({
        tenantId,
        appId: "tx-commit",
        version: "0.0.1",
        status: "active",
        capabilities: [],
        manifestHash: null,
      });
    });

    expect(await adapter.getTenantApp!(tenantId, "tx-commit")).toMatchObject({
      appId: "tx-commit",
      version: "0.0.1",
    });

    await adapter.deleteTenantApp(tenantId, "tx-commit");
  });
});

async function rowCount(db: any, tid: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM tenant_apps WHERE tenant_id = ${tid}
  `)) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

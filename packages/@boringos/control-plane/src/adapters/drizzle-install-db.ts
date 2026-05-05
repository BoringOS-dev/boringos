// SPDX-License-Identifier: BUSL-1.1
//
// Drizzle-backed implementation of the install pipeline's DB contract.
// Wraps the framework's `tenant_apps` table (C1) so the C5 install
// pipeline can run against a real Postgres / embedded-Postgres connection.
//
// Exposes `transaction(fn)` so the kernel adapter (K7) can run the full
// install sequence (insert + schema migrations + agent/workflow/route
// registration + onTenantCreated) atomically.

import { and, eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { tenantApps } from "@boringos/db";

import type { InstallPipelineDb, TenantAppRow } from "../install.js";

// Drizzle's transaction handle has the same query surface as the root Db.
// Extract it from the Db type so the adapter binds against either a
// connection or a transaction without manually re-typing the surface.
type DrizzleTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run insert/select/delete — root Db or a tx handle. */
type Executor = Pick<Db, "select" | "insert" | "delete">;

/**
 * The install pipeline DB plus a transaction helper. The pipeline only
 * needs `InstallPipelineDb`, but downstream wiring (K7) uses
 * `transaction()` to wrap the whole install sequence atomically.
 */
export interface DrizzleInstallDb extends InstallPipelineDb {
  /**
   * Run `fn` inside a Drizzle transaction. The pipeline-shaped DB passed
   * to `fn` is bound to the transaction, so all writes share a snapshot
   * and roll back together if `fn` throws.
   */
  transaction<T>(
    fn: (txDb: InstallPipelineDb, tx: DrizzleTx) => Promise<T>,
  ): Promise<T>;
}

function toRow(record: typeof tenantApps.$inferSelect): TenantAppRow {
  return {
    id: record.id,
    tenantId: record.tenantId,
    appId: record.appId,
    version: record.version,
    status: record.status as TenantAppRow["status"],
    capabilities: record.capabilities ?? [],
    manifestHash: record.manifestHash,
  };
}

function bindAdapter(executor: Executor): InstallPipelineDb {
  return {
    async insertTenantApp(row: TenantAppRow): Promise<void> {
      await executor.insert(tenantApps).values({
        tenantId: row.tenantId,
        appId: row.appId,
        version: row.version,
        status: row.status,
        capabilities: row.capabilities,
        manifestHash: row.manifestHash ?? null,
      });
    },

    async deleteTenantApp(tenantId: string, appId: string): Promise<void> {
      await executor
        .delete(tenantApps)
        .where(
          and(eq(tenantApps.tenantId, tenantId), eq(tenantApps.appId, appId)),
        );
    },

    async getTenantApp(
      tenantId: string,
      appId: string,
    ): Promise<TenantAppRow | null> {
      const rows = await executor
        .select()
        .from(tenantApps)
        .where(
          and(eq(tenantApps.tenantId, tenantId), eq(tenantApps.appId, appId)),
        )
        .limit(1);
      const row = rows[0];
      return row ? toRow(row) : null;
    },
  };
}

/**
 * Build an InstallPipelineDb that hits the real `tenant_apps` table.
 *
 * Pass the root `Db` for a non-transactional adapter. Pass a Drizzle
 * transaction handle to bind the adapter to that transaction. Most
 * callers use `createDrizzleInstallDb(db).transaction(async (txDb) => …)`.
 */
export function createDrizzleInstallDb(db: Db): DrizzleInstallDb {
  return {
    ...bindAdapter(db),
    async transaction<T>(
      fn: (txDb: InstallPipelineDb, tx: DrizzleTx) => Promise<T>,
    ): Promise<T> {
      return db.transaction(async (tx) => {
        return fn(bindAdapter(tx), tx);
      });
    },
  };
}

/**
 * Bind to an existing transaction handle when you already have one
 * (e.g. when composing with other transactional writers).
 */
export function bindDrizzleInstallDbToTx(tx: DrizzleTx): InstallPipelineDb {
  return bindAdapter(tx);
}

export type { DrizzleTx };

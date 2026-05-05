// SPDX-License-Identifier: BUSL-1.1
//
// Drizzle-backed implementation of the C5 uninstall pipeline's DB
// contract. Pairs with createDrizzleInstallDb (K1) — same connection,
// different shape.

import { and, eq } from "drizzle-orm";

import type { Db } from "@boringos/db";
import { tenantAppLinks, tenantApps } from "@boringos/db";

import type {
  AppLinkRow,
  UninstallPipelineDb,
} from "../uninstall.js";
import type { TenantAppRow } from "../install.js";

export interface DrizzleUninstallDbOptions {
  /**
   * Optional callback that performs hard-delete of namespaced data
   * (drop tables created by K2 migrations, delete drive files, etc.).
   * If omitted, callers asking for `mode: "hard"` get an UninstallError.
   */
  hardDeleteAppData?: (tenantId: string, appId: string) => Promise<void>;
}

export function createDrizzleUninstallDb(
  db: Db,
  options: DrizzleUninstallDbOptions = {},
): UninstallPipelineDb {
  return {
    async getTenantApp(tenantId, appId): Promise<TenantAppRow | null> {
      const rows = await db
        .select()
        .from(tenantApps)
        .where(
          and(
            eq(tenantApps.tenantId, tenantId),
            eq(tenantApps.appId, appId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        appId: row.appId,
        version: row.version,
        status: row.status as TenantAppRow["status"],
        capabilities: row.capabilities ?? [],
        manifestHash: row.manifestHash,
      };
    },

    async markTenantAppUninstalling(tenantId, appId): Promise<void> {
      await db
        .update(tenantApps)
        .set({ status: "uninstalling", updatedAt: new Date() })
        .where(
          and(
            eq(tenantApps.tenantId, tenantId),
            eq(tenantApps.appId, appId),
          ),
        );
    },

    async deleteTenantApp(tenantId, appId): Promise<void> {
      await db
        .delete(tenantApps)
        .where(
          and(
            eq(tenantApps.tenantId, tenantId),
            eq(tenantApps.appId, appId),
          ),
        );
    },

    async listIncomingLinks(tenantId, targetAppId): Promise<AppLinkRow[]> {
      const rows = await db
        .select()
        .from(tenantAppLinks)
        .where(
          and(
            eq(tenantAppLinks.tenantId, tenantId),
            eq(tenantAppLinks.targetAppId, targetAppId),
          ),
        );
      return rows.map((r) => ({
        tenantId: r.tenantId,
        sourceAppId: r.sourceAppId,
        targetAppId: r.targetAppId,
        capability: r.capability,
      }));
    },

    hardDeleteAppData: options.hardDeleteAppData,
  };
}

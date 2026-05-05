// SPDX-License-Identifier: BUSL-1.1
//
// K9 — provision the default-app catalog at tenant creation time.
//
// Called from the framework's onTenantCreated hook chain after the
// fresh tenant row + runtimes + copilot agent are seeded. Invokes the
// regular install pipeline (via the kernel install context from K7)
// for every catalog entry. Failures are non-fatal: signup completes
// even if one default app's install fails, and a row is logged to
// activity_log for later inspection.
//
// Re-install protection: on framework restart the hook does not run
// (it only fires on signup). For other paths that want to re-run
// provisioning idempotently, this helper short-circuits when the
// install record already exists for the tenant + appId at the same
// version — no churn, no slot-registry thrash.

import { sql } from "drizzle-orm";

import {
  createKernelInstallContext,
  type AppRouteRegistry,
  type DefaultAppEntry,
  type DefaultAppOutcome,
  type DefaultAppsResult,
  type InstallEventBus,
  type KernelInstallContext,
  type SlotInstallRuntime,
} from "@boringos/control-plane";
import type { Db } from "@boringos/db";
import type { AppDefinition } from "@boringos/app-sdk";

export interface DefaultAppCatalogEntry extends DefaultAppEntry {
  /**
   * Optional AppDefinition for the entry. The kernel install context
   * needs this to register agents/workflows/routes. Apps shipped under
   * `apps/*` typically expose a `bundle/index.js` whose default export
   * is an AppDefinition; the loader can pre-import it.
   */
  definition?: AppDefinition;

  /** Optional bundle directory used to resolve `manifest.schema`. */
  bundleDir?: string;
}

export interface ProvisionDefaultAppsArgs {
  db: Db;
  tenantId: string;
  catalog: readonly DefaultAppCatalogEntry[];
  routeRegistry: AppRouteRegistry;
  slotRuntime: SlotInstallRuntime;
  events: InstallEventBus;
  /**
   * Optional pre-built kernel install context. When omitted, a new
   * one is created from db/routeRegistry/slotRuntime/events. Pass this
   * when the host already has a live kernel context (the regular
   * /api/admin/apps/install path uses it too).
   */
  kernelContext?: KernelInstallContext;
}

export async function provisionDefaultApps(
  args: ProvisionDefaultAppsArgs,
): Promise<DefaultAppsResult> {
  const kernel =
    args.kernelContext ??
    createKernelInstallContext({
      db: args.db,
      routeRegistry: args.routeRegistry,
      slotRuntime: args.slotRuntime,
      events: args.events,
    });

  const outcomes: DefaultAppOutcome[] = [];

  for (const entry of args.catalog) {
    try {
      // Re-install protection: if the same app + version is already
      // installed for this tenant, leave it alone.
      const existing = await args.db.execute(sql`
        SELECT version FROM tenant_apps
        WHERE tenant_id = ${args.tenantId} AND app_id = ${entry.id}
      `);
      const existingRow = (existing as unknown as Array<{ version: string }>)[0];
      if (existingRow && existingRow.version === entry.manifest.version) {
        outcomes.push({
          appId: entry.id,
          installed: true,
        });
        continue;
      }

      const record = await kernel.installApp({
        manifest: entry.manifest,
        tenantId: args.tenantId,
        bundleText: entry.bundleText,
        manifestHash: entry.manifestHash,
        definition: entry.definition ?? { id: entry.id },
        bundleDir: entry.bundleDir,
      });
      outcomes.push({ appId: entry.id, installed: true, record });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      outcomes.push({ appId: entry.id, installed: false, error });
      await logProvisioningFailure(args.db, args.tenantId, entry.id, error);
    }
  }

  return {
    outcomes,
    allInstalled: outcomes.every((o) => o.installed),
  };
}

async function logProvisioningFailure(
  db: Db,
  tenantId: string,
  appId: string,
  error: Error,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO activity_log (
        tenant_id, action, entity_type, entity_id, actor_type, metadata
      )
      VALUES (
        ${tenantId},
        ${'app.install_failed'},
        ${'app'},
        ${'00000000-0000-0000-0000-000000000000'},
        ${'system'},
        ${JSON.stringify({ appId, error: error.message })}::jsonb
      )
    `);
  } catch {
    // activity log is advisory; never let it block signup.
  }
}

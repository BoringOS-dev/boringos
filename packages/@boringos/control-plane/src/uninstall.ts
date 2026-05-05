// SPDX-License-Identifier: BUSL-1.1
//
// Uninstall pipeline — reverses an install cleanly.
//
// Two modes:
//   soft  — routes unmount, agents pause, slots unregister,
//           tenant_apps marked "uninstalling", data retained the
//           configured number of days. Reversible by re-install.
//   hard  — soft steps + immediate drop of namespaced tables,
//           delete files, remove agents. Irreversible.
//
// Cascade: if another app has tenant_app_links pointing at the app
// being uninstalled, the caller is warned (the cascade list is
// returned so the UI can show "Uninstalling CRM will disable
// Accounts' invoice generation. Continue?"). The pipeline does NOT
// auto-uninstall dependent apps — callers decide whether to proceed.

import type {
  InstallEventBus,
  SlotInstallRuntime,
  TenantAppRow,
} from "./install.js";

/* ── Injected dependency interface ──────────────────────────────────── */

export interface AppLinkRow {
  tenantId: string;
  sourceAppId: string;
  targetAppId: string;
  capability: string;
}

export interface UninstallPipelineDb {
  /** Mark an install record as "uninstalling" (soft). */
  markTenantAppUninstalling(tenantId: string, appId: string): Promise<void>;
  /** Permanently delete the install record (hard, after retention). */
  deleteTenantApp(tenantId: string, appId: string): Promise<void>;
  /** Existing record lookup for "is this even installed?" */
  getTenantApp(tenantId: string, appId: string): Promise<TenantAppRow | null>;
  /**
   * List apps that have declared a dependency on the named target.
   * Used by the cascade-warning logic.
   */
  listIncomingLinks(tenantId: string, targetAppId: string): Promise<AppLinkRow[]>;
  /**
   * Hard-delete only: drop tables, files, agents, etc. owned by this
   * app. The kernel adapter wires this; v1 control-plane treats it as
   * an opaque hook.
   */
  hardDeleteAppData?(tenantId: string, appId: string): Promise<void>;
}

/* ── Public API ─────────────────────────────────────────────────────── */

export type UninstallMode = "soft" | "hard";

export interface UninstallContext {
  db: UninstallPipelineDb;
  slotRuntime: SlotInstallRuntime;
  events: InstallEventBus;
}

export interface UninstallArgs {
  tenantId: string;
  appId: string;
  mode: UninstallMode;
  /**
   * If true, proceed even when other apps depend on this one. When
   * false (the default), the pipeline returns the cascade list and
   * does nothing else — callers re-invoke with force=true after
   * showing the user the warning.
   */
  force?: boolean;
}

export interface UninstallResult {
  /** Whether the uninstall actually happened. False when blocked by an unforced cascade. */
  uninstalled: boolean;
  /** Other apps that depend on the uninstalled one (always populated). */
  cascade: AppLinkRow[];
  /** Mode that was applied (only set when uninstalled is true). */
  mode?: UninstallMode;
}

export class UninstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UninstallError";
  }
}

/**
 * Uninstall an app.
 *
 * Failure modes:
 *   - App is not installed → throws UninstallError("not installed")
 *   - Other apps depend and !force → returns { uninstalled: false, cascade: [...] }
 *   - Hard-delete with no `hardDeleteAppData` adapter → throws
 *
 * Slot unregistration runs unconditionally (idempotent). DB updates
 * run after slot unregistration so a slot failure doesn't leave the
 * registry in a half-state with the install record still active.
 */
export async function uninstallApp(
  ctx: UninstallContext,
  args: UninstallArgs,
): Promise<UninstallResult> {
  const { tenantId, appId, mode, force = false } = args;

  // 1. Confirm the app is installed.
  const existing = await ctx.db.getTenantApp(tenantId, appId);
  if (!existing) {
    throw new UninstallError(`App "${appId}" is not installed in tenant ${tenantId}`);
  }

  // 2. Cascade check.
  const cascade = await ctx.db.listIncomingLinks(tenantId, appId);
  if (cascade.length > 0 && !force) {
    return { uninstalled: false, cascade };
  }

  // 3. Hard-delete needs the adapter to exist.
  if (mode === "hard" && !ctx.db.hardDeleteAppData) {
    throw new UninstallError(
      "Hard uninstall requested but no hardDeleteAppData adapter is wired",
    );
  }

  // 4. Slot unregistration first — frees the chrome from the app
  // before we touch the DB record. Failures here are best-effort:
  // the registry is fault-tolerant about removing things that aren't
  // there, so we let exceptions propagate without partial-state risk.
  ctx.slotRuntime.uninstallApp(appId);

  // 5. DB update according to mode.
  if (mode === "soft") {
    await ctx.db.markTenantAppUninstalling(tenantId, appId);
  } else {
    // hard
    await ctx.db.hardDeleteAppData!(tenantId, appId);
    await ctx.db.deleteTenantApp(tenantId, appId);
  }

  // 6. Emit event. Best-effort, like install.
  try {
    await ctx.events.emit("app.uninstalled", {
      tenantId,
      appId,
      mode,
      cascade: cascade.map((l) => ({
        sourceAppId: l.sourceAppId,
        capability: l.capability,
      })),
    });
  } catch {
    // Swallow — operators see this in the activity log on bus recovery.
  }

  return { uninstalled: true, cascade, mode };
}

// SPDX-License-Identifier: BUSL-1.1
//
// Default-app provisioning (TASK-E3).
//
// On tenant signup with `tenantName`, the framework's onTenantCreated
// hook calls into installDefaultApps(ctx, tenantId). For each default
// app this module knows about, it invokes the regular install
// pipeline (C5). Failures are recorded and returned but never thrown —
// signup must succeed even if one default app's install fails.
//
// The default-app list is a static catalog the kernel ships with. The
// production catalog is provided by the kernel adapter via the
// `catalog` argument; this module's exported DEFAULT_APPS_CATALOG is
// the authoritative shape, populated lazily so apps not yet present
// (E1/E2) don't break the build chain.

import type { Manifest } from "@boringos/app-sdk";

import {
  installApp,
  type InstallContext,
  type InstallRecord,
} from "./install.js";

/**
 * Catalog entry — a default app the kernel pre-installs at tenant
 * provision. The manifest object can be loaded from disk or imported
 * directly; the install pipeline doesn't care which.
 */
export interface DefaultAppEntry {
  /** App id, matches manifest.id. Used for logging + dedupe. */
  id: string;
  /** Parsed manifest (already validated against the SDK schema). */
  manifest: Manifest;
  /**
   * Optional bundle text for the capability-honesty check. Production
   * passes the compiled bundle here; tests can leave it empty.
   */
  bundleText?: string;
  /** Optional: precomputed manifest hash. */
  manifestHash?: string;
}

export interface DefaultAppOutcome {
  appId: string;
  /** True when the install pipeline returned a record. */
  installed: boolean;
  /** Set when installed=true. */
  record?: InstallRecord;
  /** Set when installed=false: the error the install threw. */
  error?: Error;
}

export interface DefaultAppsResult {
  outcomes: DefaultAppOutcome[];
  /** Convenience: true when every default app installed cleanly. */
  allInstalled: boolean;
}

/**
 * Install every entry in the catalog into a tenant. Failures don't
 * abort the loop — each app gets its own try/catch and the result
 * carries every outcome. The caller (kernel's onTenantCreated hook)
 * decides what to do with partial-failure results: in v1, signup
 * still succeeds and the tenant is told one or both pre-installs
 * failed via a notification.
 */
export async function installDefaultApps(
  ctx: InstallContext,
  tenantId: string,
  catalog: readonly DefaultAppEntry[],
): Promise<DefaultAppsResult> {
  const outcomes: DefaultAppOutcome[] = [];

  for (const entry of catalog) {
    try {
      const record = await installApp(ctx, {
        manifest: entry.manifest,
        bundleText: entry.bundleText,
        tenantId,
        manifestHash: entry.manifestHash,
      });
      outcomes.push({ appId: entry.id, installed: true, record });
    } catch (e) {
      outcomes.push({
        appId: entry.id,
        installed: false,
        error: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return {
    outcomes,
    allInstalled: outcomes.every((o) => o.installed),
  };
}

/**
 * Authoritative catalog the kernel ships with. The kernel adapter
 * populates this at boot time from the apps/ directory's bundled
 * manifests. v1 leaves it empty by default — the kernel's
 * onTenantCreated hook supplies its own catalog when calling
 * installDefaultApps. Tests pass an explicit fixture catalog.
 *
 * Production wiring (kernel-side) reads:
 *   apps/generic-triage/boringos.json
 *   apps/generic-replier/boringos.json
 * and turns each into a DefaultAppEntry with the bundle text loaded
 * alongside.
 */
export const DEFAULT_APPS_CATALOG: readonly DefaultAppEntry[] = [];

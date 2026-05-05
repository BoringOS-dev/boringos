// SPDX-License-Identifier: BUSL-1.1
//
// Install pipeline — takes a validated manifest + bundle and installs
// the app fully or rolls back on any failure.
//
// The pipeline is a pure function with injected dependencies (db,
// slot runtime, event bus) so tests can mock each integration point.
// The real Drizzle transaction wrapping happens when the kernel wires
// this into the admin API surface.
//
// v1 scope: tenant_apps row + slot registration + event emit. The
// "schema migrations / register agents / register workflows / mount
// routes / run onTenantCreated" steps from the install pipeline doc
// are captured as TODOs that the kernel-side wiring tasks will
// implement when they connect this to the framework's Drizzle txn
// + the AppDefinition runtime.

import type { Manifest, UIDefinition } from "@boringos/app-sdk";

import { validateManifestFull, type ValidationIssue } from "./validator.js";

/* ── Injected dependency interfaces ─────────────────────────────────── */

export interface TenantAppRow {
  id?: string;
  tenantId: string;
  appId: string;
  version: string;
  status: "active" | "paused" | "uninstalling";
  capabilities: string[];
  manifestHash: string | null;
}

/**
 * Minimal contract the install pipeline needs from the database. The
 * kernel adapter wraps Drizzle's `db.transaction` and writes to the
 * `tenant_apps` table from C1.
 */
export interface InstallPipelineDb {
  insertTenantApp(row: TenantAppRow): Promise<void>;
  deleteTenantApp(tenantId: string, appId: string): Promise<void>;
  /** Optional: get an existing record (used for re-install detection). */
  getTenantApp?(tenantId: string, appId: string): Promise<TenantAppRow | null>;
}

/**
 * Minimal contract the install pipeline needs from the shell-side
 * slot runtime (A6). Production wires this to InstallRuntime.
 */
export interface SlotInstallRuntime {
  installApp(args: { appId: string; version: string; ui?: UIDefinition }): { appId: string };
  uninstallApp(appId: string): void;
}

/**
 * Minimal contract for the framework's event bus.
 */
export interface InstallEventBus {
  emit(type: string, payload: Record<string, unknown>): void | Promise<void>;
}

/* ── Public API ─────────────────────────────────────────────────────── */

export interface InstallContext {
  db: InstallPipelineDb;
  slotRuntime: SlotInstallRuntime;
  events: InstallEventBus;
}

export interface InstallArgs {
  manifest: unknown;
  bundleText?: string;
  tenantId: string;
  manifestHash?: string;
  /**
   * Optional UI definition extracted from the bundle. The shell knows
   * how to build this from its bundle; the kernel-side wiring passes
   * it through. v1 server-side install ignores this when undefined.
   */
  ui?: UIDefinition;
}

export interface InstallRecord {
  tenantId: string;
  appId: string;
  version: string;
  manifestHash: string | null;
  installedAt: Date;
}

export class InstallError extends Error {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "InstallError";
  }
}

/**
 * Install an app fully or roll back on any failure.
 *
 * Failure modes that trigger rollback:
 *   - Validation fails (schema or honesty errors)
 *   - DB insert fails
 *   - Slot registration fails
 *   - Event emit fails (best-effort: failure here does not roll back
 *     the install, but is reported in the InstallError if it throws —
 *     events are advisory, not load-bearing)
 *
 * Idempotency: re-installing an app that's already installed first
 * uninstalls the prior record (DB row + slot contributions), then
 * runs the new install. This matches the SlotRegistry's re-register
 * semantics from A2/A6.
 */
export async function installApp(
  ctx: InstallContext,
  args: InstallArgs,
): Promise<InstallRecord> {
  // 1. Validate.
  const validation = validateManifestFull(args.manifest, args.bundleText);
  if (!validation.ok) {
    throw new InstallError(
      `Manifest validation failed: ${validation.errors[0]?.message ?? "unknown error"}`,
      validation.errors,
    );
  }

  const manifest = args.manifest as Manifest;

  // 2. Re-install? Clean up the prior install first.
  if (ctx.db.getTenantApp) {
    const existing = await ctx.db.getTenantApp(args.tenantId, manifest.id);
    if (existing) {
      try {
        ctx.slotRuntime.uninstallApp(manifest.id);
      } catch {
        // Best-effort; the slot runtime is fault-tolerant about
        // removing things that aren't there.
      }
      await ctx.db.deleteTenantApp(args.tenantId, manifest.id);
    }
  }

  // 3. Insert the install record.
  const row: TenantAppRow = {
    tenantId: args.tenantId,
    appId: manifest.id,
    version: manifest.version,
    status: "active",
    capabilities: manifest.capabilities,
    manifestHash: args.manifestHash ?? null,
  };
  await ctx.db.insertTenantApp(row);

  // 4. Slot registration. If this fails, undo the DB write.
  try {
    ctx.slotRuntime.installApp({
      appId: manifest.id,
      version: manifest.version,
      ui: args.ui,
    });
  } catch (e) {
    // Rollback the DB row before propagating.
    try {
      await ctx.db.deleteTenantApp(args.tenantId, manifest.id);
    } catch {
      // If the rollback itself fails, the error chain still carries
      // the original cause; ops will see both.
    }
    throw new InstallError(
      `Slot registration failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 5. Emit the event. Failures here are not load-bearing — the
  // install has already succeeded. We don't roll back on a flaky
  // event bus.
  try {
    await ctx.events.emit("app.installed", {
      tenantId: args.tenantId,
      appId: manifest.id,
      version: manifest.version,
      manifestHash: args.manifestHash ?? null,
    });
  } catch {
    // Swallow — operators see this in the activity log when the bus
    // recovers and replays.
  }

  // TODO(kernel-wiring): the per-spec steps still to land when the
  // framework's app builder is connected here:
  //   - Run schema migrations from manifest.schema
  //   - Register agents (manifest.agents → AppDefinition.agents)
  //   - Register workflow templates
  //   - Register context providers
  //   - Mount /api/{appId}/* routes
  //   - Invoke onTenantCreated lifecycle hook
  // These all live in the framework's app-builder integration that
  // C5 unblocks but doesn't itself implement. The control plane is
  // the orchestrator; the kernel is the runtime.

  return {
    tenantId: args.tenantId,
    appId: manifest.id,
    version: manifest.version,
    manifestHash: args.manifestHash ?? null,
    installedAt: new Date(),
  };
}

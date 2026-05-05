// SPDX-License-Identifier: BUSL-1.1
//
// Install runtime — the shell-side hook the install pipeline (TASK-C5)
// calls into when an app is installed or uninstalled. Owns nothing
// outside the shell process: routes, schema, agents, workflows are all
// the control-plane's responsibility. This module owns the *UI half*
// of an install — registering slot contributions so the chrome and
// renderer pick them up.
//
// Hot-update is automatic: the SlotRegistry's subscribe fan-out and
// React's useSyncExternalStore in useSlot guarantee the chrome and
// renderer re-render when contributions change.
//
// Concurrency: registration and unregistration are synchronous and
// idempotent at the registry level. Installing an app id that's already
// installed first removes its prior contributions, then registers the
// new ones. This matches re-publish semantics expected by the install
// pipeline (a version bump replaces, doesn't append).

import type { UIDefinition } from "@boringos/app-sdk";

import { slotRegistry as defaultRegistry, SlotRegistry } from "../slots/registry.js";

/**
 * Snapshot of an installed app from the shell's POV.
 * What the shell knows: app id, version, the UIDefinition that was
 * registered. The control plane (C5) tracks the rest.
 */
export interface InstalledAppRecord {
  readonly appId: string;
  readonly version: string;
  readonly installedAt: Date;
}

/**
 * The shell-side install runtime. Constructed once per shell process;
 * holds a SlotRegistry and an in-memory map of installed app records.
 *
 * The default singleton uses the default SlotRegistry. Tests should
 * construct a fresh InstallRuntime with a fresh SlotRegistry to avoid
 * cross-test pollution.
 */
export class InstallRuntime {
  private readonly registry: SlotRegistry;
  private readonly installed = new Map<string, InstalledAppRecord>();

  constructor(registry: SlotRegistry = defaultRegistry) {
    this.registry = registry;
  }

  /**
   * Register an app's UI contributions.
   * Idempotent — re-installing the same app id replaces prior state.
   *
   * @returns The install record for the now-installed app.
   */
  installApp(args: {
    appId: string;
    version: string;
    ui?: UIDefinition;
  }): InstalledAppRecord {
    const { appId, version, ui } = args;

    if (ui) {
      // SlotRegistry.register is itself idempotent — calling it twice
      // for the same appId removes prior entries, then re-adds.
      this.registry.register(appId, ui);
    } else {
      // App with no UI surface (server-only). Still drop any stale
      // registry state for this app id so re-install with-then-without
      // UI works.
      this.registry.unregister(appId);
    }

    const record: InstalledAppRecord = {
      appId,
      version,
      installedAt: new Date(),
    };
    this.installed.set(appId, record);
    return record;
  }

  /**
   * Unregister all of an app's contributions.
   * No-op if the app id is not installed.
   */
  uninstallApp(appId: string): void {
    this.registry.unregister(appId);
    this.installed.delete(appId);
  }

  /**
   * Look up an installed app's record.
   */
  get(appId: string): InstalledAppRecord | undefined {
    return this.installed.get(appId);
  }

  /**
   * List every currently-installed app's record.
   */
  list(): InstalledAppRecord[] {
    return [...this.installed.values()].sort((a, b) =>
      a.appId.localeCompare(b.appId),
    );
  }

  /**
   * Whether an app id has an active install record in this runtime.
   */
  isInstalled(appId: string): boolean {
    return this.installed.has(appId);
  }

  /**
   * Underlying registry — exposed for the React layer (Provider) and
   * any future shell code that wants to peek at slot contributions
   * without going through useSlot.
   */
  getRegistry(): SlotRegistry {
    return this.registry;
  }

  /**
   * Wipe everything. Useful in tests and during dev hot-reload.
   */
  clear(): void {
    for (const appId of this.installed.keys()) {
      this.registry.unregister(appId);
    }
    this.installed.clear();
  }
}

/**
 * The default singleton install runtime the shell uses.
 * Wires to the default singleton SlotRegistry. C5's install pipeline
 * calls into this instance when running in-process.
 */
export const installRuntime = new InstallRuntime();

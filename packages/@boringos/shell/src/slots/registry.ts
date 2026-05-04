// SPDX-License-Identifier: BUSL-1.1
//
// SlotRegistry — the shell's runtime store of slot contributions.
//
// Apps register their UIDefinition at install time (via the install
// pipeline that lands in TASK-A6/C5). The registry indexes every
// contribution by family + slotId + appId so the shell's chrome and
// renderer can query without knowing which apps exist.
//
// Subscription model is plain pub/sub — no React dependency. The React
// context wrapper lives in context.tsx.

import type { UIDefinition } from "@boringos/app-sdk";

import {
  ALL_SLOT_FAMILIES,
  type SlotContribution,
  type SlotFamily,
  type SlotMap,
} from "./types.js";

type Listener = () => void;

type ContributionsByFamily = {
  [F in SlotFamily]: SlotContribution<F>[];
};

function emptyContributions(): ContributionsByFamily {
  return {
    pages: [],
    dashboardWidgets: [],
    entityActions: [],
    entityDetailPanels: [],
    settingsPanels: [],
    copilotTools: [],
    commandActions: [],
    inboxHandlers: [],
  };
}

export class SlotRegistry {
  private contributions: ContributionsByFamily = emptyContributions();
  private listeners = new Set<Listener>();

  /**
   * Register all UI slot contributions an app exposes via its UIDefinition.
   * Idempotent for a given appId — re-registering replaces prior state
   * for that app.
   */
  register(appId: string, ui: UIDefinition): void {
    // Drop anything we previously stored for this app — re-register
    // semantics are "replace" not "append" so updates don't leak old
    // contributions.
    this.removeApp(appId);

    for (const family of ALL_SLOT_FAMILIES) {
      const contributions = ui[family];
      if (!contributions) continue;

      for (const [slotId, slot] of Object.entries(contributions)) {
        // Strict typing of the union per family is enforced by the
        // SlotMap type; the cast is safe within a discriminator pass.
        (this.contributions[family] as SlotContribution<typeof family>[]).push({
          appId,
          slotId,
          family,
          slot: slot as SlotMap[typeof family],
        });
      }
    }

    this.notify();
  }

  /**
   * Remove all contributions an app has made.
   * Called from the uninstall pipeline (TASK-C6).
   */
  unregister(appId: string): void {
    const removed = this.removeApp(appId);
    if (removed > 0) this.notify();
  }

  /**
   * List contributions to a specific family.
   * Optional `id` filters to a single slot id.
   * Optional `appId` filters to a single contributing app.
   *
   * The return type narrows to the family's slot interface, so callers
   * do not need to discriminate.
   */
  list<F extends SlotFamily>(
    family: F,
    options: { id?: string; appId?: string } = {},
  ): SlotContribution<F>[] {
    const all = this.contributions[family] as SlotContribution<F>[];
    return all.filter((c) => {
      if (options.id !== undefined && c.slotId !== options.id) return false;
      if (options.appId !== undefined && c.appId !== options.appId) return false;
      return true;
    });
  }

  /**
   * Look up a single contribution by family + slot id.
   * Returns the first match, or undefined if no app has contributed
   * that id. (Multiple apps contributing the same id is allowed at the
   * registry level; the shell's UI decides whether to disambiguate.)
   */
  get<F extends SlotFamily>(
    family: F,
    id: string,
  ): SlotContribution<F> | undefined {
    return (this.contributions[family] as SlotContribution<F>[]).find(
      (c) => c.slotId === id,
    );
  }

  /**
   * The set of app ids currently contributing to any slot.
   */
  installedApps(): string[] {
    const set = new Set<string>();
    for (const family of ALL_SLOT_FAMILIES) {
      for (const c of this.contributions[family]) set.add(c.appId);
    }
    return [...set].sort();
  }

  /**
   * Subscribe to registry mutations. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Wipe everything. Useful in tests and during development hot-reload.
   */
  clear(): void {
    this.contributions = emptyContributions();
    this.notify();
  }

  /* ── internal ────────────────────────────────────────────────── */

  private removeApp(appId: string): number {
    let removed = 0;
    for (const family of ALL_SLOT_FAMILIES) {
      const before = this.contributions[family].length;
      const arr = this.contributions[family] as SlotContribution<typeof family>[];
      const filtered = arr.filter((c) => c.appId !== appId);
      removed += before - filtered.length;
      // Reassign with the right element type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.contributions[family] as unknown as SlotContribution<typeof family>[]) = filtered;
    }
    return removed;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/**
 * Default global registry instance the shell uses.
 * Tests should construct fresh `SlotRegistry` instances rather than
 * mutate this one.
 */
export const slotRegistry = new SlotRegistry();

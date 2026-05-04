// SPDX-License-Identifier: BUSL-1.1
//
// React adapter around the SlotRegistry: a Provider that injects a
// registry instance, plus hooks the shell's chrome and renderer use.

import {
  createContext,
  useContext,
  useSyncExternalStore,
  useMemo,
  type ReactNode,
} from "react";

import { SlotRegistry, slotRegistry as defaultRegistry } from "./registry.js";
import type { SlotContribution, SlotFamily } from "./types.js";

const SlotRegistryContext = createContext<SlotRegistry>(defaultRegistry);

export function SlotRegistryProvider({
  registry = defaultRegistry,
  children,
}: {
  registry?: SlotRegistry;
  children: ReactNode;
}) {
  return (
    <SlotRegistryContext.Provider value={registry}>
      {children}
    </SlotRegistryContext.Provider>
  );
}

/**
 * Access the registry directly. Useful for imperative actions
 * (e.g. invoking a CopilotTool from a non-rendering pathway).
 */
export function useSlotRegistry(): SlotRegistry {
  return useContext(SlotRegistryContext);
}

/**
 * Subscribe to the contributions of a slot family. Re-renders when
 * apps are installed or uninstalled.
 *
 * @example
 *   const widgets = useSlot("dashboardWidgets");
 *   const actions = useSlot("entityActions", { id: "send-followup" });
 */
export function useSlot<F extends SlotFamily>(
  family: F,
  options: { id?: string; appId?: string } = {},
): SlotContribution<F>[] {
  const registry = useSlotRegistry();
  const { id, appId } = options;

  // Subscribe to mutations; return a stable snapshot.
  const subscribe = useMemo(
    () => (cb: () => void) => registry.subscribe(cb),
    [registry],
  );

  // useSyncExternalStore needs identity-stable snapshots — recompute
  // only when filters or registry change.
  const getSnapshot = useMemo(() => {
    let last: SlotContribution<F>[] | null = null;
    let lastKey = "";
    return () => {
      const next = registry.list(family, { id, appId });
      // Cheap shallow comparison via length + ids string. Ensures
      // useSyncExternalStore's identity check passes when nothing
      // actually changed.
      const key = next.map((c) => c.appId + "/" + c.slotId).join("|");
      if (last && key === lastKey) return last;
      last = next;
      lastKey = key;
      return next;
    };
  }, [registry, family, id, appId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

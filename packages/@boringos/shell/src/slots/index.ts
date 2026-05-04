// SPDX-License-Identifier: BUSL-1.1
//
// Public surface of the shell's slot system.

export type {
  SlotMap,
  SlotFamily,
  SlotContribution,
} from "./types.js";

export { ALL_SLOT_FAMILIES } from "./types.js";

export { SlotRegistry, slotRegistry } from "./registry.js";

export {
  SlotRegistryProvider,
  useSlotRegistry,
  useSlot,
} from "./context.js";

export { SlotRenderer } from "./SlotRenderer.js";

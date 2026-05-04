// SPDX-License-Identifier: BUSL-1.1
//
// Slot type taxonomy used by the shell's runtime.
//
// The SDK side (@boringos/app-sdk) defines the slot interfaces an app
// fills in (NavSlot, DashboardWidget, etc.). This file maps the
// UIDefinition's field names — which are also the slot family names —
// to the concrete interfaces, so the registry, renderer, and hooks can
// be typed end-to-end.

import type {
  NavSlot,
  DashboardWidget,
  EntityAction,
  EntityDetailPanel,
  SettingsPanel,
  CommandAction,
  CopilotTool,
  InboxHandler,
} from "@boringos/app-sdk";

/**
 * Maps each slot family (the field name on UIDefinition) to the
 * concrete slot interface.
 */
export interface SlotMap {
  pages: NavSlot;
  dashboardWidgets: DashboardWidget;
  entityActions: EntityAction;
  entityDetailPanels: EntityDetailPanel;
  settingsPanels: SettingsPanel;
  copilotTools: CopilotTool;
  commandActions: CommandAction;
  inboxHandlers: InboxHandler;
}

/**
 * Union of all slot family identifiers.
 */
export type SlotFamily = keyof SlotMap;

/**
 * A single contribution to a slot — the slot itself plus the metadata
 * the registry needs (which app contributed it, what id within the
 * family it satisfies).
 */
export interface SlotContribution<F extends SlotFamily = SlotFamily> {
  /** The app id that contributed this slot (matches manifest.id). */
  readonly appId: string;
  /** The slot id within its family (matches the UIDefinition map key). */
  readonly slotId: string;
  /** Which slot family this contribution belongs to. */
  readonly family: F;
  /** The slot instance itself. */
  readonly slot: SlotMap[F];
}

/**
 * The full enumeration of slot families. Keep in sync with SlotMap.
 */
export const ALL_SLOT_FAMILIES: readonly SlotFamily[] = [
  "pages",
  "dashboardWidgets",
  "entityActions",
  "entityDetailPanels",
  "settingsPanels",
  "copilotTools",
  "commandActions",
  "inboxHandlers",
] as const;

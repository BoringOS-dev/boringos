// SPDX-License-Identifier: MIT
//
// defineUI — produces a typed UIDefinition that the shell's slot runtime
// can consume. Maps slot ids declared in the manifest to actual slot
// implementations from B4.

import type {
  CommandAction,
  CopilotTool,
  DashboardWidget,
  EntityAction,
  EntityDetailPanel,
  InboxHandler,
  NavSlot,
  SettingsPanel,
} from "./slots.js";

/* ── UI runtime definition ─────────────────────────────────────────── */

/**
 * The runtime object an app's UI bundle exports.
 * Maps slot ids declared in the manifest to slot implementations.
 *
 * Keys must match the corresponding `manifest.ui.*[].id` entries; the
 * shell wires them up by id at install time.
 */
export interface UIDefinition {
  /** Map of nav id → page slot. Matches manifest `ui.nav[].id`. */
  pages?: Record<string, NavSlot>;

  /** Map of widget id → widget slot. Matches manifest `ui.dashboardWidgets[]`. */
  dashboardWidgets?: Record<string, DashboardWidget>;

  /** Map of entity action id → action slot. Matches manifest `ui.entityActions[].id`. */
  entityActions?: Record<string, EntityAction>;

  /** Map of entity detail panel id → panel slot. */
  entityDetailPanels?: Record<string, EntityDetailPanel>;

  /** Map of settings panel id → panel slot. Matches manifest `ui.settingsPanels[]`. */
  settingsPanels?: Record<string, SettingsPanel>;

  /** Map of copilot tool name → tool slot. Matches manifest `ui.copilotTools[]`. */
  copilotTools?: Record<string, CopilotTool>;

  /** Map of command action id → action slot. Matches manifest `ui.commandActions[]`. */
  commandActions?: Record<string, CommandAction>;

  /** Map of inbox handler id → handler slot (UI rendering only — see slots.ts). */
  inboxHandlers?: Record<string, InboxHandler>;
}

/* ── Helper ────────────────────────────────────────────────────────── */

/**
 * Identity helper that narrows the argument to a typed UIDefinition.
 *
 * @example
 * ```ts
 * export default defineUI({
 *   pages: { pipeline: { id: "pipeline", component: PipelinePage } },
 *   dashboardWidgets: {
 *     "open-deals": { id: "open-deals", size: "medium", component: OpenDealsWidget },
 *   },
 *   entityActions: {
 *     "send-followup": {
 *       id: "send-followup",
 *       entity: "crm_deal",
 *       label: "Send follow-up",
 *       invoke: async (deal, ctx) => { ... },
 *     },
 *   },
 * });
 * ```
 */
export function defineUI<const T extends UIDefinition>(def: T): T {
  return def;
}

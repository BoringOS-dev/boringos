// SPDX-License-Identifier: MIT
//
// defineUI — produces a typed UIDefinition that the shell's slot runtime
// can consume.
//
// The slot type interfaces (NavSlot, DashboardWidget, EntityAction,
// CopilotTool, InboxHandler, etc.) are placeholders here; B4 fleshes them
// out with React component types and full action signatures.

/* ── Placeholder slot component types (refined in B4) ──────────────── */

/**
 * Page component for a nav entry. React component in practice;
 * typed as `unknown` here to keep the SDK React-version-agnostic
 * until B4 introduces the full slot interfaces.
 */
export type PageComponent = unknown;

export type WidgetComponent = unknown;

export type EntityActionInvoker = unknown;

export type CopilotToolHandler = unknown;

export type CommandActionInvoker = unknown;

export type InboxItemHandler = unknown;

export type SettingsPanelComponent = unknown;

/* ── UI runtime definition ─────────────────────────────────────────── */

/**
 * The runtime object an app's UI bundle exports.
 * Maps slot ids declared in the manifest to actual component / handler
 * implementations the shell's slot runtime mounts.
 */
export interface UIDefinition {
  /** Map of nav id → page component. Keys must match manifest `ui.nav[].id`. */
  pages?: Record<string, PageComponent>;

  /** Map of widget id → component. */
  dashboardWidgets?: Record<string, WidgetComponent>;

  /** Map of entity action id → handler. */
  entityActions?: Record<string, EntityActionInvoker>;

  /** Map of settings panel id → component. */
  settingsPanels?: Record<string, SettingsPanelComponent>;

  /** Map of copilot tool name → handler (matches manifest `ui.copilotTools`). */
  copilotTools?: Record<string, CopilotToolHandler>;

  /** Map of command action id → handler. */
  commandActions?: Record<string, CommandActionInvoker>;

  /** Map of inbox handler id → handler. */
  inboxHandlers?: Record<string, InboxItemHandler>;
}

/* ── Helper ────────────────────────────────────────────────────────── */

/**
 * Identity helper that narrows the argument to a typed UIDefinition.
 *
 * @example
 * ```ts
 * export default defineUI({
 *   pages: { pipeline: PipelinePage, contacts: ContactsPage },
 *   dashboardWidgets: { "open-deals": OpenDealsWidget },
 *   entityActions: { "send-followup": sendFollowup },
 * });
 * ```
 */
export function defineUI<const T extends UIDefinition>(def: T): T {
  return def;
}

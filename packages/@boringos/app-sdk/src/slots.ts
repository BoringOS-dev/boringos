// SPDX-License-Identifier: MIT
//
// Slot interfaces — the named extension points the shell exposes to apps.
// Apps contribute via defineUI() and the manifest's `ui.*` fields.
//
// Slot taxonomy (see docs/shell-screens.md and docs/coordination.md):
//   - nav                   — sidebar entries
//   - dashboard.widget      — Home screen tiles
//   - entity.detail         — tabs/panels on entity detail pages
//   - entity.action         — buttons/actions on entity records
//   - settings.panel        — per-app config panels in Settings
//   - command.action        — global command bar (Cmd+K) entries
//   - copilot.tool          — tools the copilot can invoke
//   - inbox.handler         — UI rendering for inbox items (UI-only; no
//                             agent wake — agents wake via workflows)
//
// Component types use a structural function signature so this package
// stays React-version-agnostic. The shell (A6) renders them with React.

import type { ActionContext, CommandContext, JSONSchema, ToolContext } from "./context.js";

/* ── Component placeholder ──────────────────────────────────────────── */

/**
 * Structural type for any UI component. Compatible with React function
 * components without forcing a React import in this package. The shell
 * runtime (A6) does the actual React rendering.
 */
export type SlotComponent<Props = Record<string, unknown>> = (props: Props) => unknown;

/* ── Generic entity ─────────────────────────────────────────────────── */

/**
 * A generic entity instance. Apps that define their own entity types
 * narrow the type id (e.g. "crm_contact") at the call site.
 */
export interface Entity<TypeId extends string = string> {
  /** Entity id (uuid). */
  id: string;

  /** Entity type, e.g. "crm_contact". Matches manifest entityTypes[].id. */
  type: TypeId;

  /** Free-form fields. */
  fields: Record<string, unknown>;

  /** App-namespaced custom fields (jsonb in DB). */
  customFields?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

/* ── Nav ────────────────────────────────────────────────────────────── */

/**
 * Sidebar nav entry. Pairs with a manifest `ui.nav[]` declaration.
 */
export interface NavSlot {
  /** Matches the manifest's `ui.nav[].id`. */
  id: string;

  /** Page component mounted when the user clicks the entry. */
  component: SlotComponent;
}

/* ── Dashboard widget ───────────────────────────────────────────────── */

export interface DashboardWidget {
  id: string;

  /** Grid sizing on the Home dashboard. */
  size: "small" | "medium" | "large";

  component: SlotComponent;
}

/* ── Entity detail panel ────────────────────────────────────────────── */

/**
 * A tab or panel rendered inside another entity's detail page.
 * Allows cross-app extension: Accounts can add a "Billing" tab to a
 * crm_contact (with capability + dependency declared).
 */
export interface EntityDetailPanel<TypeId extends string = string> {
  id: string;

  /** Entity type this panel attaches to. */
  entity: TypeId;

  /** Tab label in the entity detail header. */
  label: string;

  /** Lower numbers sort earlier. */
  order?: number;

  /** Panel content; receives the entity as a prop. */
  component: SlotComponent<{ entity: Entity<TypeId> }>;
}

/* ── Entity action ──────────────────────────────────────────────────── */

export interface EntityAction<TypeId extends string = string> {
  id: string;

  /** Entity type this action attaches to. */
  entity: TypeId;

  label: string;

  icon?: string;

  /** Optional predicate; when false the action is hidden for that entity. */
  visible?: (entity: Entity<TypeId>) => boolean;

  /** Invoked when the user clicks the action. */
  invoke: (entity: Entity<TypeId>, ctx: ActionContext) => Promise<void>;
}

/* ── Settings panel ─────────────────────────────────────────────────── */

export interface SettingsPanel {
  /** Matches the manifest's `ui.settingsPanels[]` entry. */
  id: string;

  /** Heading shown in the Settings sidebar. */
  label: string;

  component: SlotComponent;
}

/* ── Command action (Cmd+K) ─────────────────────────────────────────── */

export interface CommandAction {
  id: string;

  /** Visible label in the command bar. */
  label: string;

  /** Search keywords to match against user input. */
  keywords: string[];

  icon?: string;

  /** Invoked when the user selects the action. */
  invoke: (ctx: CommandContext) => Promise<void>;
}

/* ── Copilot tool ───────────────────────────────────────────────────── */

/**
 * A function the copilot can invoke during a thread. The tool's
 * inputSchema is forwarded to the harness as a tool-use schema.
 */
export interface CopilotTool {
  /** Tool name as the copilot sees it. */
  name: string;

  description: string;

  /** JSON Schema for the tool's input. */
  inputSchema: JSONSchema;

  /** Optional output schema (for documentation; not enforced). */
  outputSchema?: JSONSchema;

  /** Invoked when the copilot calls the tool. */
  invoke: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/* ── Inbox handler (UI-only) ────────────────────────────────────────── */

/**
 * An inbox item, as it appears in the unified inbox stream.
 */
export interface InboxItem {
  id: string;
  source: string;
  subject?: string;
  body?: string;
  from?: string;
  /** Free-form metadata enriched by Triage and other apps. */
  metadata?: Record<string, unknown>;
  status: "unread" | "read" | "snoozed" | "archived";
  createdAt: Date;
}

/**
 * A custom action exposed on an inbox item by an installed app.
 * Examples: "Convert to Deal", "Create Ticket", "Forward to Slack".
 */
export interface InboxItemAction {
  id: string;
  label: string;
  icon?: string;
  invoke: (item: InboxItem, ctx: ActionContext) => Promise<void>;
}

/**
 * Inbox handler — UI rendering only.
 *
 * **This slot does not wake agents.** Agent waking on inbox events happens
 * through workflows that subscribe to `inbox.item_created`. See
 * docs/coordination.md.
 *
 * The handler controls how an item *renders* and what custom *actions* the
 * user sees. Multiple handlers can match a single item; the user picks.
 */
export interface InboxHandler {
  id: string;

  /** Predicate. Cheap, deterministic — no LLM calls. */
  matches: (item: InboxItem) => boolean;

  /** Custom rendering of the inbox item. */
  render: SlotComponent<{ item: InboxItem }>;

  /** Custom actions exposed on items this handler matches. */
  actions: InboxItemAction[];
}

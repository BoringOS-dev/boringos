// SPDX-License-Identifier: MIT
//
// defineApp — produces a typed AppDefinition that the runtime can consume.
// Identity helper that pairs with the manifest from B2.
//
// Several supporting types (AgentDefinition, WorkflowTemplate, ContextProvider,
// LifecycleContext) are intentionally kept lean here; B4 expands them.

/* ── Placeholder types (refined in B4) ─────────────────────────────── */

/**
 * Lifecycle context passed to onTenantCreated, onUpgrade, onUninstall.
 * Full shape (db handle, logger, version diff, etc.) lands in B4.
 */
export interface LifecycleContext {
  tenantId: string;
  /** Refined in B4. */
  [extra: string]: unknown;
}

export type LifecycleHook = (ctx: LifecycleContext) => Promise<void>;

/**
 * Lifecycle hook fired on app version upgrade. Receives the version diff.
 */
export type UpgradeHook = (
  ctx: LifecycleContext & { fromVersion: string; toVersion: string }
) => Promise<void>;

/**
 * Agent registration shape. Refined in B4 with persona, runtime, triggers,
 * budget, contextProviders.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  /** Refined in B4. */
  [extra: string]: unknown;
}

/**
 * Workflow template registered at tenant provision. Refined in B4.
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  /** Refined in B4. */
  [extra: string]: unknown;
}

/**
 * Context provider that injects information into agent prompts at runtime.
 * Refined in B4.
 */
export interface ContextProvider {
  id: string;
  /** Refined in B4. */
  [extra: string]: unknown;
}

/**
 * Route registrar — receives a router (Hono) and mounts routes on it.
 * The full Router shape comes from the runtime in B4 / C5.
 */
export type RouteRegistrar = (router: unknown) => void;

/* ── App runtime definition ────────────────────────────────────────── */

export interface AppDefinition {
  /** App identifier (must match the manifest's `id`). */
  id: string;

  agents?: AgentDefinition[];

  workflows?: WorkflowTemplate[];

  contextProviders?: ContextProvider[];

  /** Mount HTTP routes under /api/{id}/*. */
  routes?: RouteRegistrar;

  /** Run at install: seed data, register agents, etc. */
  onTenantCreated?: LifecycleHook;

  /** Run on version bumps. */
  onUpgrade?: UpgradeHook;

  /** Run when tenant uninstalls (soft or hard). */
  onUninstall?: LifecycleHook;
}

/* ── Helper ────────────────────────────────────────────────────────── */

/**
 * Identity helper that narrows the argument to a typed AppDefinition.
 *
 * @example
 * ```ts
 * export default defineApp({
 *   id: "crm",
 *   agents: [emailTriage, contactEnrichment],
 *   workflows: [emailIngest],
 *   onTenantCreated: async (ctx) => { ...seed default pipeline... }
 * });
 * ```
 */
export function defineApp<const T extends AppDefinition>(def: T): T {
  return def;
}

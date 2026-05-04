// SPDX-License-Identifier: MIT
//
// defineApp — produces a typed AppDefinition that the runtime can consume.
// Pairs with the manifest from B2 and the lifecycle/context types from B4.

import type { LifecycleHook, UpgradeHook } from "./lifecycle.js";
import type {
  ContextBuildContext,
  ContextProviderOutput,
} from "./context.js";

/* ── Agent / workflow / context provider types ─────────────────────── */

/**
 * Agent registration shape. The runtime fields (persona, runtime adapter,
 * triggers, budget) are kept loose here; they will be refined when the
 * runtime catches up to the SDK contract (Phase 2 / 3).
 */
export interface AgentDefinition {
  id: string;
  name: string;
  /** Persona id (one of the 12 built-ins or "custom"). */
  persona?: string;
  /** Runtime adapter ("claude", "codex", "gemini", "ollama", "command", "webhook"). */
  runtime?: string;
  /** System prompt / instructions. */
  instructions?: string;
  /** Reserved for future fields. */
  [extra: string]: unknown;
}

/**
 * Workflow template registered at tenant provision. The full DAG / block
 * shape lives in @boringos/workflow; the SDK accepts it opaquely so this
 * package does not depend on the workflow engine package.
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  /** Reserved for the full DAG payload from @boringos/workflow. */
  [extra: string]: unknown;
}

/**
 * Context provider — injects information into agent prompts at runtime.
 */
export interface ContextProvider {
  id: string;

  /** Scope at which this provider runs. */
  scope: "task" | "session" | "global";

  /** Build the markdown / structured context to inject. */
  build: (ctx: ContextBuildContext) => Promise<ContextProviderOutput>;

  /** Sort priority (lower = earlier in the prompt). */
  priority?: number;
}

/**
 * Route registrar — receives a router (Hono) and mounts routes on it.
 * The router shape is opaque here; the install pipeline (C5) will pass
 * a typed Hono router. The optional `agentDocs` makes the routes
 * discoverable by the copilot's api-catalog context provider.
 */
export interface RouteRegistrar {
  (router: unknown): void;

  /**
   * Optional: function returning a markdown blob describing the routes.
   * Injected into agent prompts via the api-catalog provider so agents
   * know how to call the app's API.
   */
  agentDocs?: (baseUrl: string) => string;
}

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

  /** Run on version bumps. Receives version diff via the context. */
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
 *   onTenantCreated: async (ctx) => { ...seed default pipeline... },
 * });
 * ```
 */
export function defineApp<const T extends AppDefinition>(def: T): T {
  return def;
}

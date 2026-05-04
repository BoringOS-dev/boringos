// SPDX-License-Identifier: MIT
//
// Runtime context types — what handlers (entity actions, copilot tools,
// command actions, context providers) receive when invoked at runtime.
//
// This file declares shapes only. The runtime that constructs and
// dispatches these contexts lives in the shell + install pipeline.

import type { Database, Logger } from "./lifecycle.js";

/* ── JSON Schema (loose) ────────────────────────────────────────────── */

/**
 * JSON Schema document. Loose by design — the SDK does not bundle a
 * full JSON Schema validator. The shell validates at install time
 * (TASK-C4) and at action invocation.
 */
export type JSONSchema = Record<string, unknown>;

/* ── Tenant identity ────────────────────────────────────────────────── */

/**
 * Identity of the current tenant + user invoking a handler.
 * Set by the shell's auth middleware before dispatch.
 */
export interface CallerIdentity {
  tenantId: string;
  userId: string;
  /** "admin" | "member" | string for custom roles. */
  role: string;
}

/* ── Action context ─────────────────────────────────────────────────── */

/**
 * Context passed to entity action invokers and command action invokers.
 */
export interface ActionContext extends CallerIdentity {
  db: Database;
  log: Logger;

  /** Emit an event onto the shared event bus. Capability-checked. */
  emit(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

/* ── Tool context (copilot) ─────────────────────────────────────────── */

/**
 * Context passed to copilot tool handlers. Adds the conversation context
 * the tool is being invoked from.
 */
export interface ToolContext extends ActionContext {
  /** The copilot thread id this tool call is happening inside. */
  threadId: string;

  /** The user-visible message that triggered this tool call, if any. */
  triggeringMessageId?: string;
}

/* ── Command context (Cmd+K) ────────────────────────────────────────── */

/**
 * Context passed to global command bar action handlers.
 * Currently identical to ActionContext; reserved for future fields
 * (e.g. the active screen, the current selection).
 */
export interface CommandContext extends ActionContext {
  /** Reserved for future expansion. */
  readonly __brand?: "CommandContext";
}

/* ── Context provider build context ─────────────────────────────────── */

/**
 * Context passed to a ContextProvider's `build` function.
 * Context providers run during agent execution, BEFORE the agent's
 * harness is spawned, to assemble the prompt.
 */
export interface ContextBuildContext extends CallerIdentity {
  db: Database;
  log: Logger;

  /** Id of the agent whose prompt is being built. */
  agentId: string;

  /** Id of the run, if a run has been created. */
  runId?: string;

  /** Id of the task this run is operating on, if any. */
  taskId?: string;
}

/**
 * Output a context provider can return: either a markdown string or
 * a structured form the runtime knows how to format.
 */
export type ContextProviderOutput = string | StructuredContext;

export interface StructuredContext {
  /** Heading rendered above the context block. */
  heading?: string;

  /** Plain markdown body. */
  body: string;

  /** Optional priority hint (lower = earlier in the prompt). */
  priority?: number;
}

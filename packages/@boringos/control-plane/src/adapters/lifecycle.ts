// SPDX-License-Identifier: BUSL-1.1
//
// K6 — onTenantCreated invoker + LifecycleContext factory.
//
// Builds the LifecycleContext the SDK exposes to lifecycle hooks
// (onTenantCreated, onUninstall, onUpgrade) and runs the hook inside
// the install transaction. Failures bubble out so the surrounding
// transaction rolls back the agent/workflow/route registrations
// performed by K3-K5.

import type {
  AppDefinition,
  Database,
  LifecycleContext,
  Logger,
  LifecycleHook,
} from "@boringos/app-sdk";

import type { DrizzleTx } from "./drizzle-install-db.js";

export interface CreateLifecycleContextArgs {
  /**
   * The transaction handle currently executing the install. Cast to the
   * SDK's branded `Database` shape; consumers receive an opaque handle
   * that the framework's helpers know how to query against.
   */
  tx: DrizzleTx;
  tenantId: string;
  /**
   * Optional logger override. Defaults to a console-backed structured
   * logger that prefixes the tenantId.
   */
  logger?: Logger;
}

export function createLifecycleContext(
  args: CreateLifecycleContextArgs,
): LifecycleContext {
  const { tx, tenantId, logger } = args;
  return {
    tenantId,
    // The SDK's Database is a branded opaque type. The framework's
    // helpers (db helpers, query builders) accept this shape and
    // unwrap to the real Drizzle tx. The cast is necessary because
    // the SDK package does not (and should not) depend on Drizzle.
    db: tx as unknown as Database,
    log: logger ?? createConsoleLogger({ tenantId }),
  };
}

/**
 * Invoke an app's onTenantCreated hook (if defined) inside the install
 * transaction. Failures propagate, which causes the surrounding
 * `db.transaction` block to roll back every prior install step
 * (schema migrations, agent/workflow registrations, etc.).
 *
 * Out of scope: spawning agents from onTenantCreated. Apps decide
 * what to seed; this runner only executes the hook with the
 * lifecycle context.
 */
export async function invokeOnTenantCreated(
  definition: AppDefinition,
  ctx: LifecycleContext,
): Promise<void> {
  const hook: LifecycleHook | undefined = definition.onTenantCreated;
  if (!hook) return;
  await hook(ctx);
}

interface ConsoleLoggerOptions {
  tenantId: string;
}

function createConsoleLogger(options: ConsoleLoggerOptions): Logger {
  const prefix = `[tenant=${options.tenantId}]`;
  const log = (level: "debug" | "info" | "warn" | "error") =>
    (message: string, fields?: Record<string, unknown>) => {
      const payload = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
      // eslint-disable-next-line no-console
      console[level === "debug" ? "log" : level](`${prefix} ${message}${payload}`);
    };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
}

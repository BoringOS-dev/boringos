// SPDX-License-Identifier: BUSL-1.1
//
// K6 — ActionContext factory.
//
// Constructs the ActionContext the SDK exposes to entity-action,
// command-action, and copilot-tool handlers. Runtime invocations
// (post-install — these are *request-time*, not *install-time*) call
// this from the request middleware after auth resolves the caller
// identity.

import type {
  ActionContext,
  Database,
  Logger,
} from "@boringos/app-sdk";

import type { Db } from "@boringos/db";

/** Event bus the action context's `emit` delegates to. */
export interface ActionEventBus {
  emit(eventType: string, payload: Record<string, unknown>): void | Promise<void>;
}

export interface CreateActionContextArgs {
  /**
   * Db handle for the request. Either the root Db or a per-request
   * tenant-scoped wrapper — the SDK's Database brand is opaque.
   */
  db: Db | unknown;
  tenantId: string;
  userId: string;
  role: string;
  events: ActionEventBus;
  logger?: Logger;
}

export function createActionContext(
  args: CreateActionContextArgs,
): ActionContext {
  const { db, tenantId, userId, role, events, logger } = args;
  return {
    tenantId,
    userId,
    role,
    db: db as unknown as Database,
    log: logger ?? createConsoleLogger({ tenantId, userId }),
    async emit(eventType, payload) {
      await events.emit(eventType, payload);
    },
  };
}

function createConsoleLogger(options: { tenantId: string; userId: string }): Logger {
  const prefix = `[tenant=${options.tenantId} user=${options.userId}]`;
  const log = (level: "debug" | "info" | "warn" | "error") =>
    (message: string, fields?: Record<string, unknown>) => {
      const payload =
        fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
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

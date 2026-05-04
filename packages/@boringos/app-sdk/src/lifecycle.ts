// SPDX-License-Identifier: MIT
//
// Lifecycle context types — the values runtime hooks (onTenantCreated,
// onUpgrade, onUninstall) receive when invoked.
//
// This file declares the shape of the context only. The runtime that
// constructs and dispatches these contexts lives in the install pipeline
// (TASK-C5) and is not implemented here.

/* ── Logger ─────────────────────────────────────────────────────────── */

/**
 * Minimal structured logger. The shell injects a tenant-scoped instance
 * into every lifecycle hook and action context.
 */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/* ── Database handle ────────────────────────────────────────────────── */

/**
 * Tenant-scoped database handle. The runtime ensures every query is
 * automatically scoped to the calling tenant.
 *
 * Concrete shape (Drizzle, Knex, raw, etc.) is decided in TASK-C5 when the
 * install pipeline lands. For B4 it's an opaque token; refining it here
 * would couple the SDK to a specific ORM choice prematurely.
 */
export interface Database {
  /** Reserved. The runtime fills this in; SDK consumers only pass it back. */
  readonly __brand: "BoringOSDatabase";
}

/* ── Lifecycle context ──────────────────────────────────────────────── */

/**
 * Context passed to onTenantCreated and onUninstall hooks.
 */
export interface LifecycleContext {
  /** The tenant the hook is running for. */
  tenantId: string;

  /** Tenant-scoped DB handle. Use the SDK's db helpers, not raw queries. */
  db: Database;

  /** Tenant-scoped structured logger. */
  log: Logger;
}

/**
 * Context passed to onUpgrade hooks. Adds version diff fields.
 */
export interface UpgradeLifecycleContext extends LifecycleContext {
  /** Previously installed version. */
  fromVersion: string;

  /** Version being upgraded to. */
  toVersion: string;
}

/* ── Hook signatures ────────────────────────────────────────────────── */

export type LifecycleHook = (ctx: LifecycleContext) => Promise<void>;

export type UpgradeHook = (ctx: UpgradeLifecycleContext) => Promise<void>;

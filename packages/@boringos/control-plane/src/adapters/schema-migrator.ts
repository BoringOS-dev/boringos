// SPDX-License-Identifier: BUSL-1.1
//
// K2 — schema migration runner.
//
// Reads `*.sql` files from an app's manifest schema directory and
// executes them in lex order inside the install transaction. Records
// each applied migration in `tenant_app_migrations` so re-installs
// don't re-run.
//
// Drizzle-specific is fine for v1 — apps own their own migration
// sequence; the framework only orchestrates.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { sql } from "drizzle-orm";

import type { AppManifest } from "@boringos/app-sdk";

import type { DrizzleTx } from "./drizzle-install-db.js";

export interface AppMigrationRecord {
  tenantId: string;
  appId: string;
  filename: string;
  appliedAt: Date;
}

export interface RunAppMigrationsArgs {
  tenantId: string;
  app: Pick<AppManifest, "id" | "schema">;
  /**
   * Directory containing this app's bundle (the directory the manifest
   * lives in). Migrations are resolved relative to it via `app.schema`.
   * Pass undefined if `app.schema` is itself absolute.
   */
  bundleDir?: string;
}

export interface RunAppMigrationsResult {
  appliedFiles: string[];
  skippedFiles: string[];
}

/**
 * Apply pending SQL migrations for an app inside a transaction.
 *
 * Resolution rules:
 *   - If `app.schema` is absent → no-op (apps without schema are valid).
 *   - The schema path is resolved relative to `bundleDir` if provided
 *     and `app.schema` is relative; otherwise treated as absolute.
 *   - All `*.sql` files in the directory are sorted by filename.
 *
 * Idempotency: applied filenames are tracked per (tenantId, appId) in
 * `tenant_app_migrations`. Re-running with the same set of files is a
 * no-op.
 */
export async function runAppMigrations(
  tx: DrizzleTx,
  args: RunAppMigrationsArgs,
): Promise<RunAppMigrationsResult> {
  const { tenantId, app, bundleDir } = args;

  if (!app.schema) {
    return { appliedFiles: [], skippedFiles: [] };
  }

  const schemaDir = isAbsolute(app.schema)
    ? app.schema
    : bundleDir
      ? resolve(bundleDir, app.schema)
      : resolve(app.schema);

  if (!existsSync(schemaDir) || !statSync(schemaDir).isDirectory()) {
    // Manifest declared a schema dir that doesn't exist on disk. This
    // is a packaging bug, not a runtime concern; surface it loudly.
    throw new SchemaMigratorError(
      `App "${app.id}" declared schema dir "${app.schema}" but no directory exists at ${schemaDir}`,
    );
  }

  const sqlFiles = readdirSync(schemaDir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();

  if (sqlFiles.length === 0) {
    return { appliedFiles: [], skippedFiles: [] };
  }

  // Ensure the tracking table exists. Idempotent — safe to run inside
  // every install transaction.
  await tx.execute(sql`
    CREATE TABLE IF NOT EXISTS tenant_app_migrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      app_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, app_id, filename)
    )
  `);

  const alreadyApplied = await loadApplied(tx, tenantId, app.id);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const filename of sqlFiles) {
    if (alreadyApplied.has(filename)) {
      skipped.push(filename);
      continue;
    }

    const filepath = join(schemaDir, filename);
    const content = readFileSync(filepath, "utf8").trim();

    if (content.length === 0) {
      // Empty migration files are recorded but not executed — keeps a
      // monotonic ledger without forcing dummy DDL.
      await recordApplied(tx, tenantId, app.id, filename);
      applied.push(filename);
      continue;
    }

    try {
      await tx.execute(sql.raw(content));
    } catch (e) {
      throw new SchemaMigratorError(
        `Migration "${filename}" for app "${app.id}" failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e },
      );
    }

    await recordApplied(tx, tenantId, app.id, filename);
    applied.push(filename);
  }

  return { appliedFiles: applied, skippedFiles: skipped };
}

async function loadApplied(
  tx: DrizzleTx,
  tenantId: string,
  appId: string,
): Promise<Set<string>> {
  const rows = (await tx.execute(sql`
    SELECT filename FROM tenant_app_migrations
    WHERE tenant_id = ${tenantId} AND app_id = ${appId}
  `)) as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}

async function recordApplied(
  tx: DrizzleTx,
  tenantId: string,
  appId: string,
  filename: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO tenant_app_migrations (tenant_id, app_id, filename)
    VALUES (${tenantId}, ${appId}, ${filename})
    ON CONFLICT (tenant_id, app_id, filename) DO NOTHING
  `);
}

export class SchemaMigratorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SchemaMigratorError";
  }
}

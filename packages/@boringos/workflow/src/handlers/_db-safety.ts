import type { Db } from "@boringos/db";
import { sql } from "drizzle-orm";

/**
 * Safety layer shared by query-database, update-row, and (future) delete-row
 * block handlers. The concerns:
 *
 * 1. **Tenant isolation** — every query must be scoped to the workflow's
 *    tenant. We enforce this by requiring the target table have a
 *    `tenant_id` column and auto-injecting `tenant_id = $ctx.tenantId`
 *    into WHERE clauses.
 *
 * 2. **Identifier injection** — table and column names come from workflow
 *    config (human-authored). They can't be SQL-parameterized, so we
 *    validate against a strict regex and a blacklist before splicing.
 *
 * 3. **Dangerous tables** — auth/identity/credential tables are blocked
 *    outright. Tenants row is blocked (tenant mutations belong in the
 *    framework's lifecycle code, not in workflows).
 */

const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

/** Tables that workflow blocks may NEVER touch, read or write. */
const BLOCKED_TABLES = new Set([
  // Identity & auth
  "auth_users",
  "auth_accounts",
  "auth_sessions",
  "auth_verification_tokens",
  "cli_auth_challenges",
  "invitations",
  // Tenant config managed by framework lifecycle, not workflows
  "tenants",
  // Internal framework bookkeeping that shouldn't be rewritten ad-hoc
  "budget_policies",
  "budget_incidents",
]);

/** Columns that must never appear in a SET clause regardless of table. */
const BLOCKED_SET_COLUMNS = new Set([
  "id",
  "tenant_id",
  "created_at",
]);

/** Cache of "does this table have a tenant_id column" lookups. */
const tenantColumnCache = new Map<string, boolean>();

export function validateIdentifier(kind: "table" | "column", value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid ${kind} name: ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertTableAllowed(table: string): void {
  if (BLOCKED_TABLES.has(table)) {
    throw new Error(`Table "${table}" is not accessible from workflows`);
  }
}

export function assertSetColumnAllowed(column: string): void {
  if (BLOCKED_SET_COLUMNS.has(column)) {
    throw new Error(`Column "${column}" cannot be set from a workflow (managed by framework)`);
  }
}

/**
 * Verifies the table exists in public schema AND has a tenant_id column.
 * Cached per-table for the lifetime of the process.
 */
export async function requireTenantScopedTable(db: Db, table: string): Promise<void> {
  if (tenantColumnCache.has(table)) {
    if (!tenantColumnCache.get(table)) {
      throw new Error(`Table "${table}" has no tenant_id column and can't be used from workflows`);
    }
    return;
  }

  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = 'tenant_id'
    LIMIT 1
  `);
  const rows = result as unknown as Array<unknown>;
  const has = rows.length > 0;
  tenantColumnCache.set(table, has);

  if (!has) {
    throw new Error(`Table "${table}" has no tenant_id column and can't be used from workflows`);
  }
}

/**
 * Wraps a regex-validated identifier for safe splicing into SQL. Use only
 * for names that have already passed `validateIdentifier()`.
 */
export function ident(name: string) {
  return sql.raw(`"${name}"`);
}

/**
 * Builds a parameterized WHERE fragment from a shallow equality/IN map, AND-ed
 * with the tenant filter. Returns an SQL chunk ready to splice.
 *
 * Supported value shapes per column:
 *   - string | number | boolean | null → equality (`col = value`, or `col IS NULL`)
 *   - (string | number)[]              → IN list (empty array → always-false)
 */
export function buildWhereFragment(
  tenantId: string,
  where: Record<string, unknown> | undefined,
) {
  // Always scope by tenant first
  let clause = sql`tenant_id = ${tenantId}`;

  if (!where || Object.keys(where).length === 0) return clause;

  for (const [col, value] of Object.entries(where)) {
    const c = validateIdentifier("column", col);
    if (value === null) {
      clause = sql`${clause} AND ${ident(c)} IS NULL`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        clause = sql`${clause} AND FALSE`;
      } else {
        // Join the parameterized values with commas
        const placeholders = value.map((v) => sql`${v}`);
        const joined = sql.join(placeholders, sql`, `);
        clause = sql`${clause} AND ${ident(c)} IN (${joined})`;
      }
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      clause = sql`${clause} AND ${ident(c)} = ${value}`;
    } else {
      throw new Error(`Unsupported value for column "${c}": ${JSON.stringify(value)}`);
    }
  }

  return clause;
}

/** Used by tests to reset the cache between runs. */
export function _resetTenantColumnCacheForTests(): void {
  tenantColumnCache.clear();
}

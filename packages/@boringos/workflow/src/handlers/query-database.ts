import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";
import {
  validateIdentifier,
  assertTableAllowed,
  requireTenantScopedTable,
  buildWhereFragment,
  ident,
} from "./_db-safety.js";

/**
 * `query-database` block — read rows from any tenant-scoped table.
 *
 * Automatically scopes to the workflow's tenant; never returns cross-tenant
 * data. Identity tables (auth_*, tenants) are blocked by `_db-safety.ts`.
 *
 * Config:
 *   table      — Table name (e.g. "tasks"). Must have a `tenant_id` column.
 *   where?     — `{ column: value }` map. Supports equality, IN (array),
 *                NULL. All conditions AND-ed together.
 *   columns?   — Array of column names to select. Defaults to all (`*`).
 *   limit?     — Max rows (default 100, max 1000).
 *   orderBy?   — Column name. Defaults to none.
 *   orderDir?  — "asc" | "desc" (default "desc").
 *
 * Output:
 *   { rows: Record<string, unknown>[], count: number }
 *
 * Example:
 *   {
 *     type: "query-database",
 *     config: {
 *       table: "tasks",
 *       where: { origin_kind: "agent-meeting-prep", status: ["todo", "done"] },
 *       columns: ["id", "description"],
 *       limit: 50
 *     }
 *   }
 */
export const queryDatabaseHandler: BlockHandler = {
  types: ["query-database"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const db = ctx.services.get("db") as Db | undefined;
    if (!db) return { output: { error: "db service not available", rows: [], count: 0 } };

    const cfg = ctx.config as {
      table?: unknown;
      where?: Record<string, unknown>;
      columns?: unknown;
      limit?: unknown;
      orderBy?: unknown;
      orderDir?: unknown;
    };

    try {
      const table = validateIdentifier("table", cfg.table);
      assertTableAllowed(table);
      await requireTenantScopedTable(db, table);

      // Columns — validate each if provided
      let selectClause = sql.raw("*");
      if (Array.isArray(cfg.columns) && cfg.columns.length > 0) {
        const validated = cfg.columns.map((c) => validateIdentifier("column", c));
        selectClause = sql.raw(validated.map((c) => `"${c}"`).join(", "));
      }

      const whereClause = buildWhereFragment(ctx.tenantId, cfg.where);

      const limit = Math.min(Math.max(Number(cfg.limit ?? 100), 1), 1000);

      let orderClause = sql``;
      if (cfg.orderBy !== undefined) {
        const orderCol = validateIdentifier("column", cfg.orderBy);
        const dir = cfg.orderDir === "asc" ? sql.raw("ASC") : sql.raw("DESC");
        orderClause = sql` ORDER BY ${ident(orderCol)} ${dir}`;
      }

      const query = sql`SELECT ${selectClause} FROM ${ident(table)} WHERE ${whereClause}${orderClause} LIMIT ${limit}`;
      const result = await db.execute(query);
      const rows = result as unknown as Record<string, unknown>[];

      return { output: { rows, count: rows.length } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: { error: msg, rows: [], count: 0 } };
    }
  },
};

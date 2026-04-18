import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";
import {
  validateIdentifier,
  assertTableAllowed,
  assertSetColumnAllowed,
  requireTenantScopedTable,
  buildWhereFragment,
  ident,
} from "./_db-safety.js";

/**
 * `update-row` block — update rows in a tenant-scoped table.
 *
 * Safety:
 *   - Automatically AND-s `tenant_id = ctx.tenantId` into WHERE
 *   - Rejects SET on managed columns (id, tenant_id, created_at)
 *   - Rejects auth / tenants / financial tables
 *   - REQUIRES a non-empty `where` — no bare `UPDATE table SET …`
 *
 * Config:
 *   table  — Table name. Must have `tenant_id` column.
 *   where  — Required. Same shape as query-database (equality, IN, NULL).
 *   set    — Required. `{ column: value }` map. Values are parameterized;
 *            strings / numbers / booleans / null are supported.
 *
 * Output:
 *   { updated: number }   (rows affected)
 *   { error: string, updated: 0 } on validation failure
 *
 * Example (reactivate paused routines when Google is connected):
 *   {
 *     type: "update-row",
 *     config: {
 *       table: "routines",
 *       where: { status: "paused" },
 *       set: { status: "active" }
 *     }
 *   }
 */
export const updateRowHandler: BlockHandler = {
  types: ["update-row"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const db = ctx.services.get("db") as Db | undefined;
    if (!db) return { output: { error: "db service not available", updated: 0 } };

    const cfg = ctx.config as {
      table?: unknown;
      where?: Record<string, unknown>;
      set?: Record<string, unknown>;
    };

    try {
      const table = validateIdentifier("table", cfg.table);
      assertTableAllowed(table);
      await requireTenantScopedTable(db, table);

      if (!cfg.set || typeof cfg.set !== "object" || Object.keys(cfg.set).length === 0) {
        throw new Error("`set` is required and must contain at least one column");
      }
      if (!cfg.where || typeof cfg.where !== "object" || Object.keys(cfg.where).length === 0) {
        throw new Error("`where` is required to prevent mass updates");
      }

      // Build SET fragment with parameterized values
      const setEntries = Object.entries(cfg.set);
      const setParts = setEntries.map(([col, value]) => {
        const c = validateIdentifier("column", col);
        assertSetColumnAllowed(c);
        if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          throw new Error(`Unsupported value for column "${c}": ${JSON.stringify(value)}`);
        }
        return sql`${ident(c)} = ${value}`;
      });
      // Always touch updated_at. By convention every tenant-scoped table has it.
      setParts.push(sql`updated_at = now()`);
      const setClause = sql.join(setParts, sql`, `);

      const whereClause = buildWhereFragment(ctx.tenantId, cfg.where);

      // Use RETURNING 1 so we can count affected rows — the `Result` shape
      // from drizzle+postgres.js varies by driver and isn't reliable for UPDATE.
      const query = sql`UPDATE ${ident(table)} SET ${setClause} WHERE ${whereClause} RETURNING 1`;
      const result = await db.execute(query) as unknown as unknown[];
      const updated = Array.isArray(result) ? result.length : 0;

      return { output: { updated } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: { error: msg, updated: 0 } };
    }
  },
};

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { Context, Next } from "hono";

/**
 * Reusable auth middleware for app routes.
 * Resolves session token → userId + tenantId + role and sets on Hono context.
 *
 * Usage:
 * ```typescript
 * import { createAuthMiddleware } from "@boringos/core";
 * const authMiddleware = createAuthMiddleware(db);
 * app.use("/*", authMiddleware);
 * // Then in routes: c.get("userId"), c.get("tenantId"), c.get("role")
 * ```
 */
export function createAuthMiddleware(db: Db) {
  return async (c: Context, next: Next) => {
    // If tenant already set (e.g. API key auth upstream), pass through
    const existingTenant = c.req.header("X-Tenant-Id");
    if (existingTenant) {
      return next();
    }

    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const result = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer} AND s.expires_at > NOW()
      LIMIT 1
    `);

    const rows = result as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!rows[0]) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Set headers so downstream routes can read them via c.req.header()
    c.req.raw.headers.set("X-User-Id", rows[0].user_id);
    c.req.raw.headers.set("X-Tenant-Id", rows[0].tenant_id);
    c.req.raw.headers.set("X-User-Role", rows[0].role);

    return next();
  };
}

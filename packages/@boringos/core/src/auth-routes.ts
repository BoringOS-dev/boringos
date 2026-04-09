import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "@boringos/db";

/**
 * Auth routes — login, signup, session management.
 * Simple email/password auth with session tokens.
 * No external auth library dependency — self-contained.
 */
export function createAuthRoutes(db: Db, secret: string): Hono {
  const app = new Hono();

  function hashPassword(password: string): string {
    return createHmac("sha256", secret).update(password).digest("hex");
  }

  // POST /signup — create user
  app.post("/signup", async (c) => {
    const body = await c.req.json() as { name: string; email: string; password: string; tenantId?: string };

    if (!body.email || !body.password || !body.name) {
      return c.json({ error: "name, email, and password required" }, 400);
    }

    // Check if user exists
    const existing = await db.execute(sql`SELECT id FROM auth_users WHERE email = ${body.email} LIMIT 1`);
    if ((existing as unknown as unknown[]).length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const userId = randomUUID();
    const passwordHash = hashPassword(body.password);

    await db.execute(sql`
      INSERT INTO auth_users (id, name, email, email_verified)
      VALUES (${userId}, ${body.name}, ${body.email}, false)
    `);

    await db.execute(sql`
      INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password)
      VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${passwordHash})
    `);

    // Link to tenant if provided
    if (body.tenantId) {
      await db.execute(sql`
        INSERT INTO user_tenants (id, user_id, tenant_id, role)
        VALUES (${randomUUID()}, ${userId}, ${body.tenantId}, 'admin')
      `);
    }

    // Create session
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.execute(sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${sessionToken}, ${expiresAt.toISOString()})
    `);

    return c.json({ userId, token: sessionToken }, 201);
  });

  // POST /login — authenticate
  app.post("/login", async (c) => {
    const body = await c.req.json() as { email: string; password: string };

    if (!body.email || !body.password) {
      return c.json({ error: "email and password required" }, 400);
    }

    const passwordHash = hashPassword(body.password);

    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM auth_users u
      JOIN auth_accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
      WHERE u.email = ${body.email} AND a.password = ${passwordHash}
      LIMIT 1
    `);

    const rows = result as unknown as Array<{ id: string; name: string; email: string }>;
    if (!rows[0]) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const userId = rows[0].id;
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.execute(sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${sessionToken}, ${expiresAt.toISOString()})
    `);

    return c.json({ userId, token: sessionToken, name: rows[0].name, email: rows[0].email });
  });

  // GET /me — get current user from session
  app.get("/me", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email, ut.tenant_id, ut.role
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      LEFT JOIN user_tenants ut ON ut.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `);

    const rows = result as unknown as Array<{ id: string; name: string; email: string; tenant_id: string; role: string }>;
    if (!rows[0]) return c.json({ error: "Invalid or expired session" }, 401);

    return c.json({
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      tenantId: rows[0].tenant_id,
      role: rows[0].role,
    });
  });

  // POST /logout — invalidate session
  app.post("/logout", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (token) {
      await db.execute(sql`DELETE FROM auth_sessions WHERE token = ${token}`);
    }
    return c.json({ ok: true });
  });

  return app;
}

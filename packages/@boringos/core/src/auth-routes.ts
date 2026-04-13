import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "@boringos/db";

export interface TenantProvisionedHook {
  (db: Db, tenantId: string): Promise<void>;
}

/**
 * Auth routes — login, signup, session management, invitations.
 * Multi-tenant: signup can create a new tenant or join via invite.
 */
export function createAuthRoutes(
  db: Db,
  secret: string,
  provisionTenant?: (db: Db, tenantId: string) => Promise<void>,
): Hono {
  const app = new Hono();

  function hashPassword(password: string): string {
    return createHmac("sha256", secret).update(password).digest("hex");
  }

  function generateInviteCode(): string {
    return randomUUID().replace(/-/g, "").slice(0, 16);
  }

  // POST /signup — create user + tenant (new org) or join via invite
  app.post("/signup", async (c) => {
    const body = await c.req.json() as {
      name: string;
      email: string;
      password: string;
      tenantId?: string;      // join existing tenant directly (legacy)
      tenantName?: string;    // create new tenant with this name
      inviteCode?: string;    // join existing tenant via invite
    };

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

    // Create user
    await db.execute(sql`
      INSERT INTO auth_users (id, name, email, email_verified)
      VALUES (${userId}, ${body.name}, ${body.email}, false)
    `);
    await db.execute(sql`
      INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password)
      VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${passwordHash})
    `);

    if (body.inviteCode) {
      // Join existing tenant via invitation
      const invite = await db.execute(sql`
        SELECT tenant_id, role, email FROM invitations
        WHERE code = ${body.inviteCode} AND status = 'pending' AND expires_at > now()
        LIMIT 1
      `);
      const inviteRows = invite as unknown as Array<{ tenant_id: string; role: string; email: string }>;
      if (!inviteRows[0]) {
        return c.json({ error: "Invalid or expired invitation" }, 400);
      }
      if (inviteRows[0].email.toLowerCase() !== body.email.toLowerCase()) {
        return c.json({ error: "Email does not match invitation" }, 400);
      }

      await db.execute(sql`
        INSERT INTO user_tenants (id, user_id, tenant_id, role)
        VALUES (${randomUUID()}, ${userId}, ${inviteRows[0].tenant_id}, ${inviteRows[0].role})
      `);
      await db.execute(sql`
        UPDATE invitations SET status = 'accepted', accepted_at = now()
        WHERE code = ${body.inviteCode}
      `);
    } else if (body.tenantName || !body.tenantId) {
      // Create new tenant
      const tenantId = randomUUID();
      const tenantName = body.tenantName || `${body.name}'s Team`;
      const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + tenantId.slice(0, 8);

      await db.execute(sql`
        INSERT INTO tenants (id, name, slug, created_at, updated_at)
        VALUES (${tenantId}, ${tenantName}, ${slug}, now(), now())
      `);

      // Auto-seed runtimes
      await db.execute(sql`
        INSERT INTO runtimes (id, tenant_id, name, type, config, model, status, created_at, updated_at) VALUES
          (${randomUUID()}, ${tenantId}, 'claude', 'claude', '{}', 'claude-sonnet-4-20250514', 'active', now(), now()),
          (${randomUUID()}, ${tenantId}, 'chatgpt', 'chatgpt', '{}', 'gpt-4o', 'active', now(), now()),
          (${randomUUID()}, ${tenantId}, 'gemini', 'gemini', '{}', 'gemini-2.5-pro', 'active', now(), now()),
          (${randomUUID()}, ${tenantId}, 'ollama', 'ollama', '{}', null, 'active', now(), now()),
          (${randomUUID()}, ${tenantId}, 'command', 'command', '{}', null, 'active', now(), now()),
          (${randomUUID()}, ${tenantId}, 'webhook', 'webhook', '{}', null, 'active', now(), now())
      `);

      // Auto-create copilot agent
      try {
        const { createAgentFromTemplate } = await import("@boringos/agent");
        const rtRows = await db.execute(sql`
          SELECT id FROM runtimes WHERE tenant_id = ${tenantId} AND type = 'claude' LIMIT 1
        `);
        const runtimeId = (rtRows as unknown as Array<{ id: string }>)[0]?.id;
        if (runtimeId) {
          await createAgentFromTemplate(db as any, "copilot", {
            tenantId,
            name: "Copilot",
            runtimeId,
          });
        }
      } catch {
        // Non-fatal — copilot can be created later
      }

      // Link user as admin
      await db.execute(sql`
        INSERT INTO user_tenants (id, user_id, tenant_id, role)
        VALUES (${randomUUID()}, ${userId}, ${tenantId}, 'admin')
      `);

      // App-specific provisioning hook
      if (provisionTenant) {
        try {
          await provisionTenant(db, tenantId);
        } catch {
          // Non-fatal
        }
      }
    } else if (body.tenantId) {
      // Legacy: join existing tenant directly
      await db.execute(sql`
        INSERT INTO user_tenants (id, user_id, tenant_id, role)
        VALUES (${randomUUID()}, ${userId}, ${body.tenantId}, 'admin')
      `);
    }

    // Create session
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
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
    if (!rows[0]) return c.json({ error: "Invalid credentials" }, 401);

    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.execute(sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${rows[0].id}, ${sessionToken}, ${expiresAt.toISOString()})
    `);

    // Return all tenants
    const tenants = await db.execute(sql`
      SELECT ut.tenant_id as "tenantId", t.name as "tenantName", ut.role
      FROM user_tenants ut JOIN tenants t ON t.id = ut.tenant_id
      WHERE ut.user_id = ${rows[0].id} ORDER BY t.name
    `);

    return c.json({
      userId: rows[0].id,
      token: sessionToken,
      name: rows[0].name,
      email: rows[0].email,
      tenants: tenants as unknown as Array<{ tenantId: string; tenantName: string; role: string }>,
    });
  });

  // GET /me — get current user + all tenants
  app.get("/me", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ id: string; name: string; email: string }>;
    if (!rows[0]) return c.json({ error: "Invalid or expired session" }, 401);

    const tenants = await db.execute(sql`
      SELECT ut.tenant_id as "tenantId", t.name as "tenantName", ut.role
      FROM user_tenants ut JOIN tenants t ON t.id = ut.tenant_id
      WHERE ut.user_id = ${rows[0].id} ORDER BY t.name
    `) as unknown as Array<{ tenantId: string; tenantName: string; role: string }>;

    // Active tenant: from header, or first tenant
    const requestedTenant = c.req.header("X-Tenant-Id");
    const activeTenant = tenants.find((t) => t.tenantId === requestedTenant) ?? tenants[0];

    return c.json({
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      tenantId: activeTenant?.tenantId ?? null,
      tenantName: activeTenant?.tenantName ?? null,
      role: activeTenant?.role ?? null,
      tenants,
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

  // ── Invitations ────────────────────────────────────────────────────────────

  // POST /invite — create invitation (requires auth + admin role)
  app.post("/invite", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    // Resolve session
    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!sessionRows[0]) return c.json({ error: "Invalid session" }, 401);

    const requestedTenant = c.req.header("X-Tenant-Id") ?? sessionRows[0].tenant_id;
    // Re-check role for requested tenant
    const roleCheck = await db.execute(sql`
      SELECT role FROM user_tenants WHERE user_id = ${sessionRows[0].user_id} AND tenant_id = ${requestedTenant} LIMIT 1
    `);
    const roleRows = roleCheck as unknown as Array<{ role: string }>;
    if (roleRows[0]?.role !== "admin") return c.json({ error: "Admin only" }, 403);

    const body = await c.req.json() as { email: string; role?: string };
    if (!body.email) return c.json({ error: "email required" }, 400);

    const inviteRole = body.role && ["admin", "staff", "member"].includes(body.role) ? body.role : "member";
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.execute(sql`
      INSERT INTO invitations (id, tenant_id, email, role, code, invited_by, status, expires_at, created_at)
      VALUES (${randomUUID()}, ${requestedTenant}, ${body.email.toLowerCase()}, ${inviteRole}, ${code}, ${sessionRows[0].user_id}, 'pending', ${expiresAt.toISOString()}, now())
    `);

    return c.json({ code, inviteLink: `/signup?invite=${code}` }, 201);
  });

  // GET /invitations — list pending invitations for current tenant
  app.get("/invitations", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string }>;
    if (!sessionRows[0]) return c.json({ error: "Invalid session" }, 401);

    const tenantId = c.req.header("X-Tenant-Id") ?? sessionRows[0].tenant_id;

    const invites = await db.execute(sql`
      SELECT id, email, role, code, status, expires_at as "expiresAt", created_at as "createdAt"
      FROM invitations WHERE tenant_id = ${tenantId} AND status = 'pending'
      ORDER BY created_at DESC
    `);

    return c.json({ data: invites });
  });

  // DELETE /invitations/:id — revoke invitation
  app.delete("/invitations/:id", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!sessionRows[0] || sessionRows[0].role !== "admin") return c.json({ error: "Admin only" }, 403);

    await db.execute(sql`DELETE FROM invitations WHERE id = ${c.req.param("id")} AND tenant_id = ${sessionRows[0].tenant_id}`);
    return c.json({ ok: true });
  });

  // ── Team management ────────────────────────────────────────────────────────

  // GET /team — list users in current tenant
  app.get("/team", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string }>;
    if (!sessionRows[0]) return c.json({ error: "Invalid session" }, 401);

    const tenantId = c.req.header("X-Tenant-Id") ?? sessionRows[0].tenant_id;

    const users = await db.execute(sql`
      SELECT u.id as "userId", u.name, u.email, ut.role, ut.created_at as "joinedAt"
      FROM user_tenants ut JOIN auth_users u ON u.id = ut.user_id
      WHERE ut.tenant_id = ${tenantId} ORDER BY ut.created_at
    `);

    return c.json({ data: users });
  });

  // PATCH /team/:userId/role — change role (admin only)
  app.patch("/team/:userId/role", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!sessionRows[0] || sessionRows[0].role !== "admin") return c.json({ error: "Admin only" }, 403);

    const body = await c.req.json() as { role: string };
    if (!body.role) return c.json({ error: "role required" }, 400);

    const tenantId = c.req.header("X-Tenant-Id") ?? sessionRows[0].tenant_id;
    await db.execute(sql`
      UPDATE user_tenants SET role = ${body.role}
      WHERE user_id = ${c.req.param("userId")} AND tenant_id = ${tenantId}
    `);
    return c.json({ ok: true });
  });

  // DELETE /team/:userId — remove user from tenant (admin only)
  app.delete("/team/:userId", async (c) => {
    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Not authenticated" }, 401);

    const session = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW() LIMIT 1
    `);
    const sessionRows = session as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!sessionRows[0] || sessionRows[0].role !== "admin") return c.json({ error: "Admin only" }, 403);
    if (c.req.param("userId") === sessionRows[0].user_id) return c.json({ error: "Cannot remove yourself" }, 400);

    const tenantId = c.req.header("X-Tenant-Id") ?? sessionRows[0].tenant_id;
    await db.execute(sql`
      DELETE FROM user_tenants WHERE user_id = ${c.req.param("userId")} AND tenant_id = ${tenantId}
    `);
    return c.json({ ok: true });
  });

  return app;
}

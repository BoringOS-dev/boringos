/**
 * Phase 11 Smoke Tests — User Auth + Activity Logging
 *
 * Tests signup, login, session-based admin access, and activity audit trail.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_KEY = "test-auth-admin";

async function bootServer(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-auth-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir, port },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "test-auth-secret", adminKey: ADMIN_KEY },
  });
  return app.listen(0);
}

describe("user auth: signup and login", () => {
  it("signup creates user and returns session token", async () => {
    const server = await bootServer(5585);
    try {
      // Create a tenant first
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Auth Corp", slug: "auth-corp" });

      // Signup
      const signupRes = await fetch(`${server.url}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", email: "alice@test.com", password: "secret123", tenantId }),
      });
      expect(signupRes.status).toBe(201);
      const signup = await signupRes.json() as { userId: string; token: string };
      expect(signup.userId).toBeTruthy();
      expect(signup.token).toBeTruthy();

      // Login
      const loginRes = await fetch(`${server.url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@test.com", password: "secret123" }),
      });
      expect(loginRes.status).toBe(200);
      const login = await loginRes.json() as { userId: string; token: string; name: string };
      expect(login.name).toBe("Alice");
      expect(login.token).toBeTruthy();

      // Get current user
      const meRes = await fetch(`${server.url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${login.token}` },
      });
      expect(meRes.status).toBe(200);
      const me = await meRes.json() as { name: string; email: string; tenantId: string };
      expect(me.name).toBe("Alice");
      expect(me.tenantId).toBe(tenantId);
    } finally {
      await server.close();
    }
  }, 30000);

  it("login fails with wrong password", async () => {
    const server = await bootServer(5584);
    try {
      // Signup first
      await fetch(`${server.url}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob", email: "bob@test.com", password: "correct" }),
      });

      // Wrong password
      const res = await fetch(`${server.url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob@test.com", password: "wrong" }),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  it("admin API accepts session token", async () => {
    const server = await bootServer(5583);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Session Corp", slug: "session-corp" });

      // Signup with tenant
      const signupRes = await fetch(`${server.url}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Carol", email: "carol@test.com", password: "pass", tenantId }),
      });
      const { token } = await signupRes.json() as { token: string };

      // Use session token to access admin API (no API key, no X-Tenant-Id)
      const agentsRes = await fetch(`${server.url}/api/admin/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(agentsRes.status).toBe(200);
      const body = await agentsRes.json() as { agents: unknown[] };
      expect(body.agents).toEqual([]);
    } finally {
      await server.close();
    }
  }, 30000);
});

describe("activity logging", () => {
  it("admin mutations create activity log entries", async () => {
    const server = await bootServer(5582);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Log Corp", slug: "log-corp" });

      const h = {
        "Content-Type": "application/json",
        "X-API-Key": ADMIN_KEY,
        "X-Tenant-Id": tenantId,
      };

      // Create agent (should log)
      await fetch(`${server.url}/api/admin/agents`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: "Log Bot", role: "engineer" }),
      });

      // Create task (should log)
      await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title: "Log task" }),
      });

      // Check activity log
      const activityRes = await fetch(`${server.url}/api/admin/activity`, { headers: h });
      expect(activityRes.status).toBe(200);
      const body = await activityRes.json() as { activity: Array<{ action: string }> };

      expect(body.activity.length).toBeGreaterThanOrEqual(2);
      const actions = body.activity.map((a) => a.action);
      expect(actions).toContain("agent.created");
      expect(actions).toContain("task.created");
    } finally {
      await server.close();
    }
  }, 30000);
});

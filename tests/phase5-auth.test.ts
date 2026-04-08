/**
 * Phase 5 Smoke Tests — Callback API JWT Auth
 *
 * Verifies that the callback API rejects unauthenticated requests
 * and accepts authenticated ones.
 */
import { describe, it, expect } from "vitest";

// ── JWT utility ─────────────────────────────────────────────────────────────

describe("JWT utility", () => {
  it("sign and verify round-trip", async () => {
    const { signCallbackToken, verifyCallbackToken } = await import("@boringos/agent");

    const token = signCallbackToken(
      { runId: "run-1", agentId: "agent-1", tenantId: "tenant-1" },
      "test-secret",
    );

    const claims = verifyCallbackToken(token, "test-secret");
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("run-1");
    expect(claims!.agent_id).toBe("agent-1");
    expect(claims!.tenant_id).toBe("tenant-1");
  });

  it("rejects token with wrong secret", async () => {
    const { signCallbackToken, verifyCallbackToken } = await import("@boringos/agent");

    const token = signCallbackToken(
      { runId: "run-1", agentId: "agent-1", tenantId: "tenant-1" },
      "correct-secret",
    );

    const claims = verifyCallbackToken(token, "wrong-secret");
    expect(claims).toBeNull();
  });

  it("rejects garbage tokens", async () => {
    const { verifyCallbackToken } = await import("@boringos/agent");
    expect(verifyCallbackToken("not-a-jwt", "secret")).toBeNull();
    expect(verifyCallbackToken("a.b", "secret")).toBeNull();
    expect(verifyCallbackToken("", "secret")).toBeNull();
  });
});

// ── Callback API auth ───────────────────────────────────────────────────────

describe("callback API auth", () => {
  it("rejects requests without Authorization header", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-auth-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5594 },
      drive: { root: join(dataDir, "drive") },
    });

    const server = await app.listen(0);

    try {
      // No auth header — should get 401
      const res = await fetch(`${server.url}/api/agent/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test" }),
      });
      expect(res.status).toBe(401);

      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("Authorization");
    } finally {
      await server.close();
    }
  }, 30000);

  it("rejects requests with invalid token", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-auth2-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5593 },
      drive: { root: join(dataDir, "drive") },
    });

    const server = await app.listen(0);

    try {
      const res = await fetch(`${server.url}/api/agent/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer fake-token-here",
        },
        body: JSON.stringify({ title: "test" }),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  it("accepts requests with valid signed token", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-auth3-"));
    const secret = "test-auth-secret";
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5592 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret },
    });

    const server = await app.listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const { tenants, agents: agentsTable } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      // Create tenant + agent so we have valid IDs
      const tenantId = generateId();
      const agentId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Auth Test", slug: "auth-test" });
      await db.insert(agentsTable).values({ id: agentId, tenantId, name: "Auth Agent", role: "engineer" });

      // Sign a valid token
      const token = signCallbackToken(
        { runId: generateId(), agentId, tenantId },
        secret,
      );

      // GET a task that doesn't exist — should get 404 (not 401)
      const res = await fetch(`${server.url}/api/agent/tasks/${generateId()}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      expect(res.status).toBe(404); // authenticated but task not found

      // /health is still unauthenticated
      const healthRes = await fetch(`${server.url}/health`);
      expect(healthRes.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 30000);
});

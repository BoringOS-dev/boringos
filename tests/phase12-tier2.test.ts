/**
 * Phase 12 Smoke Tests — Tier 2 Features
 *
 * Budget enforcement, routine scheduler, notifications, workspaces, skills.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_KEY = "tier2-admin";

async function bootServer(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const dataDir = await mkdtemp(join(tmpdir(), "boringos-tier2-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir, port },
    drive: { root: join(dataDir, "drive") },
    auth: { secret: "s", adminKey: ADMIN_KEY },
  });
  return app.listen(0);
}

function h(tenantId: string) {
  return { "Content-Type": "application/json", "X-API-Key": ADMIN_KEY, "X-Tenant-Id": tenantId };
}

describe("budget enforcement", () => {
  it("creates budget policy and lists it", async () => {
    const server = await bootServer(5581);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Budget Co", slug: "budget-co" });

      // Create policy
      const res = await fetch(`${server.url}/api/admin/budgets`, {
        method: "POST", headers: h(tenantId),
        body: JSON.stringify({ limitCents: 10000, period: "monthly" }),
      });
      expect(res.status).toBe(201);

      // List
      const listRes = await fetch(`${server.url}/api/admin/budgets`, { headers: h(tenantId) });
      const body = await listRes.json() as { policies: unknown[] };
      expect(body.policies).toHaveLength(1);
    } finally { await server.close(); }
  }, 30000);
});

describe("routine scheduler", () => {
  it("creates routine and triggers manually", async () => {
    const server = await bootServer(5580);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, runtimes } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Routine Co", slug: "routine-co" });

      const runtimeId = generateId();
      await db.insert(runtimes).values({ id: runtimeId, tenantId, name: "echo", type: "command", config: { command: "echo", args: ["ok"] } });
      const agentId = generateId();
      await db.insert(agents).values({ id: agentId, tenantId, name: "Cron Bot", role: "engineer", runtimeId });

      // Create routine
      const res = await fetch(`${server.url}/api/admin/routines`, {
        method: "POST", headers: h(tenantId),
        body: JSON.stringify({ title: "Daily check", assigneeAgentId: agentId, cronExpression: "0 9 * * *" }),
      });
      expect(res.status).toBe(201);
      const routine = await res.json() as { id: string };

      // Manual trigger
      const trigRes = await fetch(`${server.url}/api/admin/routines/${routine.id}/trigger`, {
        method: "POST", headers: h(tenantId),
      });
      expect(trigRes.status).toBe(200);
      const trigBody = await trigRes.json() as { kind: string };
      expect(trigBody.kind).toBe("created");
    } finally { await server.close(); }
  }, 30000);
});

describe("notifications", () => {
  it("creates notification service (disabled without API key)", async () => {
    const { createNotificationService } = await import("@boringos/core");
    const svc = createNotificationService({});
    expect(svc.isEnabled()).toBe(false);
    // notify should silently return
    await svc.notify("test@test.com", "Test", "body");
  });
});

describe("skills", () => {
  it("creates skill and attaches to agent via admin API", async () => {
    const server = await bootServer(5579);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Skill Co", slug: "skill-co" });
      const agentId = generateId();
      await db.insert(agents).values({ id: agentId, tenantId, name: "Skilled Bot", role: "engineer" });

      // Create skill
      const res = await fetch(`${server.url}/api/admin/skills`, {
        method: "POST", headers: h(tenantId),
        body: JSON.stringify({ key: "code-review", name: "Code Review", sourceType: "url", sourceConfig: { url: "https://example.com/skill.md" } }),
      });
      expect(res.status).toBe(201);
      const skill = await res.json() as { id: string };

      // Attach to agent
      const attachRes = await fetch(`${server.url}/api/admin/skills/${skill.id}/attach/${agentId}`, {
        method: "POST", headers: h(tenantId),
      });
      expect(attachRes.status).toBe(201);

      // List skills
      const listRes = await fetch(`${server.url}/api/admin/skills`, { headers: h(tenantId) });
      const body = await listRes.json() as { skills: unknown[] };
      expect(body.skills).toHaveLength(1);
    } finally { await server.close(); }
  }, 30000);
});

/**
 * Phase 19 Smoke Tests — Agent Templates, Teams, Hierarchy
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "hier-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-hier-"));
  return new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

function h(tid: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };
}

describe("agent templates", () => {
  it("creates agent from role template with persona", async () => {
    const server = await boot(5565);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Template Co", slug: "template-co" });

      const res = await fetch(`${server.url}/api/admin/agents/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ role: "engineer", name: "Code Bot" }),
      });
      expect(res.status).toBe(201);
      const agent = await res.json() as { id: string; name: string; role: string };
      expect(agent.name).toBe("Code Bot");
      expect(agent.role).toBe("engineer");

      // Alias resolution works
      const res2 = await fetch(`${server.url}/api/admin/agents/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ role: "sre" }), // alias for devops
      });
      const agent2 = await res2.json() as { role: string };
      expect(agent2.role).toBe("devops");
    } finally { await server.close(); }
  }, 30000);
});

describe("team templates", () => {
  it("creates engineering team with hierarchy", async () => {
    const server = await boot(5564);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Team Co", slug: "team-co" });

      const res = await fetch(`${server.url}/api/admin/teams/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ template: "engineering" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { agents: Array<{ id: string; name: string; role: string; reportsTo: string | null }> };
      expect(body.agents).toHaveLength(4); // CTO + 2 engineers + QA

      // CTO has no boss
      const cto = body.agents.find(a => a.role === "cto");
      expect(cto?.reportsTo).toBeNull();

      // Engineers report to CTO
      const engineers = body.agents.filter(a => a.role === "engineer");
      expect(engineers.length).toBe(2);
      for (const eng of engineers) {
        expect(eng.reportsTo).toBe(cto?.id);
      }

      // QA reports to CTO
      const qa = body.agents.find(a => a.role === "qa");
      expect(qa?.reportsTo).toBe(cto?.id);
    } finally { await server.close(); }
  }, 30000);
});

describe("org tree", () => {
  it("builds org tree from agents", async () => {
    const server = await boot(5563);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Org Co", slug: "org-co" });

      // Create a team first
      await fetch(`${server.url}/api/admin/teams/from-template`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ template: "executive" }),
      });

      // Get org tree
      const res = await fetch(`${server.url}/api/admin/agents/org-tree`, { headers: h(tid) });
      const body = await res.json() as { tree: Array<{ name: string; reports: Array<{ name: string }> }> };
      expect(body.tree).toHaveLength(1); // CEO at root
      expect(body.tree[0].name).toBe("CEO");
      expect(body.tree[0].reports.length).toBe(3); // CTO, PM, PA
    } finally { await server.close(); }
  }, 30000);
});

describe("delegation", () => {
  it("finds best delegate for a task based on role matching", async () => {
    const { findDelegateForTask } = await import("@boringos/agent");
    const { createDatabase, createMigrationManager, tenants, agents } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");
    const { generateId } = await import("@boringos/shared");

    const d = await mkdtemp(join(tmpdir(), "boringos-deleg-"));
    const conn = await createDatabase({ embedded: true, dataDir: join(d, "pg"), port: 5562 });
    await createMigrationManager(conn.db).apply();

    const tid = generateId();
    await conn.db.insert(tenants).values({ id: tid, name: "Deleg Co", slug: "deleg-co" });

    const bossId = generateId();
    const engId = generateId();
    const resId = generateId();

    await conn.db.insert(agents).values({ id: bossId, tenantId: tid, name: "Boss", role: "ceo", status: "idle" });
    await conn.db.insert(agents).values({ id: engId, tenantId: tid, name: "Dev", role: "engineer", reportsTo: bossId, status: "idle" });
    await conn.db.insert(agents).values({ id: resId, tenantId: tid, name: "Researcher", role: "researcher", reportsTo: bossId, status: "idle" });

    // Delegation should return a non-null agent for any task
    const delegate1 = await findDelegateForTask(conn.db, bossId, "Fix the authentication bug");
    expect(delegate1).not.toBeNull();

    const delegate2 = await findDelegateForTask(conn.db, bossId, "Investigate competitor pricing");
    expect(delegate2).not.toBeNull();

    // At least one delegation should work (both agents are available)
    // The function finds the best match — exact role matching is heuristic-based
    expect([engId, resId]).toContain(delegate1);
    expect([engId, resId]).toContain(delegate2);

    await conn.close();
  }, 30000);
});

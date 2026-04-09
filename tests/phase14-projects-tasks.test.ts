/**
 * Phase 14 Smoke Tests — Projects, Goals, Task Features
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "proj-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-proj-"));
  return new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

function h(tid: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };
}

describe("projects & goals", () => {
  it("creates project with prefix and auto-generates task identifiers", async () => {
    const server = await boot(5577);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Proj Co", slug: "proj-co" });

      // Create project
      const projRes = await fetch(`${server.url}/api/admin/projects`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ name: "Alpha", prefix: "ALPHA" }),
      });
      expect(projRes.status).toBe(201);
      const proj = await projRes.json() as { id: string; prefix: string };
      expect(proj.prefix).toBe("ALPHA");

      // Create task in project — should get auto-identifier ALPHA-001
      const taskRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ title: "First task", projectId: proj.id }),
      });
      expect(taskRes.status).toBe(201);
      const task1 = await taskRes.json() as { identifier: string };
      expect(task1.identifier).toBe("ALPHA-001");

      // Second task — ALPHA-002
      const task2Res = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ title: "Second task", projectId: proj.id }),
      });
      const task2 = await task2Res.json() as { identifier: string };
      expect(task2.identifier).toBe("ALPHA-002");

      // Task without project — gets BOS-001
      const task3Res = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ title: "Standalone task" }),
      });
      const task3 = await task3Res.json() as { identifier: string };
      expect(task3.identifier).toBe("BOS-001");

      // Create goal
      const goalRes = await fetch(`${server.url}/api/admin/goals`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ title: "Ship v1" }),
      });
      expect(goalRes.status).toBe(201);

      // List goals
      const listRes = await fetch(`${server.url}/api/admin/goals`, { headers: h(tid) });
      const listBody = await listRes.json() as { goals: unknown[] };
      expect(listBody.goals).toHaveLength(1);
    } finally { await server.close(); }
  }, 30000);
});

describe("labels", () => {
  it("creates labels and tags tasks", async () => {
    const server = await boot(5576);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Label Co", slug: "label-co" });

      // Create label
      const labelRes = await fetch(`${server.url}/api/admin/labels`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ name: "bug", color: "#ff0000" }),
      });
      expect(labelRes.status).toBe(201);
      const label = await labelRes.json() as { id: string };

      // Create task
      const taskRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ title: "Fix bug" }),
      });
      const task = await taskRes.json() as { id: string };

      // Tag task
      const tagRes = await fetch(`${server.url}/api/admin/tasks/${task.id}/labels/${label.id}`, {
        method: "POST", headers: h(tid),
      });
      expect(tagRes.status).toBe(201);

      // List labels
      const listRes = await fetch(`${server.url}/api/admin/labels`, { headers: h(tid) });
      const body = await listRes.json() as { labels: unknown[] };
      expect(body.labels).toHaveLength(1);
    } finally { await server.close(); }
  }, 30000);
});

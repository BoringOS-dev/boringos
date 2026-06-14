/**
 * Phase 21 Smoke Tests — New Task Modal "Wake the agent now"
 *
 * Tests that the NewTaskModal's "Wake the agent now" checkbox actually fires
 * a wake event when creating a task and assigning it to an agent.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "modal-wake-admin";
const tempDirs: string[] = [];

// Suppress CONNECTION_ENDED errors from postgres library cleanup
process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === "CONNECTION_ENDED" || reason?.errno === "CONNECTION_ENDED") {
    return; // Silently ignore Postgres connection cleanup errors
  }
  throw reason;
});

async function boot() {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-modal-"));
  tempDirs.push(d);
  const randomPort = 5500 + Math.floor(Math.random() * 1000);
  return new BoringOS({
    database: { embedded: true, dataDir: d, port: randomPort },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

afterEach(async () => {
  // Allow database connections to fully close and sockets to release
  await new Promise(resolve => setTimeout(resolve, 2000));
  // Clean up from the end (most recent) to avoid race conditions
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (!d) continue;
    // Retry cleanup a few times as Postgres may still hold locks
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(d, { recursive: true, force: true });
        break;
      } catch (e) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        // On final attempt, silently ignore — Postgres may still hold file locks
      }
    }
  }
}, 20000);

function headers(tenantId: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tenantId };
}

describe("NewTaskModal: wake fires", () => {

  it("assignTask with wake=true creates and enqueues wakeup request", async () => {
    const server = await boot();
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks, agentWakeupRequests } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // 1. Create tenant
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Modal Test", slug: "modal-test" });

      // 2. Create agent (runtime is host-wide via BORINGOS_RUNTIME)
      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Agent",
        role: "engineer",
      });

      // 4. Create task (simulating modal's createTask)
      const createRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          title: "Test task from modal",
          description: "Testing modal wake functionality",
          priority: "medium",
          originKind: "manual",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // 5. Verify task was created
      const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(taskRows).toHaveLength(1);
      expect(taskRows[0].assigneeAgentId).toBeNull(); // Not assigned yet

      // 6. Assign task with wake=true (simulating modal's assignTask call with wake checkbox)
      const assignRes = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          agentId,
          wake: true, // This is the "Wake the agent now" checkbox
        }),
      });
      expect(assignRes.status).toBe(200);
      const assignResult = (await assignRes.json()) as { assigned: boolean; wakeup?: { kind: string; wakeupRequestId?: string } };
      expect(assignResult.assigned).toBe(true);
      expect(assignResult.wakeup?.kind).toBe("created");

      // 7. Verify task is now assigned
      const updatedTask = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(updatedTask[0].assigneeAgentId).toBe(agentId);

      // 8. Verify wakeup request was created and enqueued
      const wakeups = await db.select().from(agentWakeupRequests).where(
        eq(agentWakeupRequests.agentId, agentId),
      ).limit(1);
      expect(wakeups).toHaveLength(1);
      expect(wakeups[0].tenantId).toBe(tenantId);
      expect(wakeups[0].reason).toBe("manual_request");
      expect(wakeups[0].taskId).toBe(taskId);
      // Status is "pending" — the queue will process it and create a run
      expect(wakeups[0].status).toBe("pending");
    } finally {
      const db = server.context.db as any;
      await new Promise(r => setTimeout(r, 100));
      if (db.end) {
        try {
          await db.end();
        } catch {
          // Suppress CONNECTION_ENDED errors during cleanup
        }
      }
      await server.close();
    }
  }, 180000);

  it("assignTask without wake does not create wakeup request", async () => {
    const server = await boot();
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks, agentWakeupRequests } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // Setup: tenant, agent (runtime is host-wide via BORINGOS_RUNTIME)
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "No Wake Test", slug: "no-wake-test" });

      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Agent",
        role: "engineer",
      });

      // Create task
      const createRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          title: "Task without wake",
          priority: "medium",
          originKind: "manual",
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // Assign WITHOUT wake
      const assignRes = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          agentId,
          // wake: true is NOT set
        }),
      });
      expect(assignRes.status).toBe(200);
      const assignResult = (await assignRes.json()) as { assigned: boolean; wakeup?: unknown };
      expect(assignResult.assigned).toBe(true);
      expect(assignResult.wakeup).toBeUndefined();

      // Verify task is assigned
      const updatedTask = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(updatedTask[0].assigneeAgentId).toBe(agentId);

      // Verify NO wakeup request was created for this task
      const wakeups = await db.select().from(agentWakeupRequests).where(
        eq(agentWakeupRequests.taskId, taskId),
      ).limit(1);
      expect(wakeups).toHaveLength(0);
    } finally {
      const db = server.context.db as any;
      await new Promise(r => setTimeout(r, 100));
      if (db.end) {
        try {
          await db.end();
        } catch {
          // Suppress CONNECTION_ENDED errors during cleanup
        }
      }
      await server.close();
    }
  }, 180000);

  it("assignTask with wake=true twice returns coalesced on second call", async () => {
    const server = await boot();
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks, agentWakeupRequests } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // Setup: tenant, agent, task
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Coalesce Test", slug: "coalesce-test" });

      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Agent",
        role: "engineer",
      });

      const createRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          title: "Coalesce test task",
          priority: "medium",
          originKind: "manual",
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // First assign with wake=true
      const assign1 = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({ agentId, wake: true }),
      });
      expect(assign1.status).toBe(200);
      const result1 = (await assign1.json()) as { wakeup?: { kind: string } };
      expect(result1.wakeup?.kind).toBe("created");

      // Verify first wakeup was created
      const wakeups1 = await db.select().from(agentWakeupRequests).where(
        eq(agentWakeupRequests.taskId, taskId),
      );
      expect(wakeups1).toHaveLength(1);
      const firstWakeupId = wakeups1[0].id;
      const firstCoalescedCount = wakeups1[0].coalescedCount ?? 0;

      // Second assign with wake=true (same task, same agent)
      const assign2 = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({ agentId, wake: true }),
      });
      expect(assign2.status).toBe(200);
      const result2 = (await assign2.json()) as { wakeup?: { kind: string } };
      expect(result2.wakeup?.kind).toBe("coalesced");

      // Verify only ONE wakeup exists (not two), but coalescedCount incremented
      const wakeups2 = await db.select().from(agentWakeupRequests).where(
        eq(agentWakeupRequests.taskId, taskId),
      );
      expect(wakeups2).toHaveLength(1);
      expect(wakeups2[0].id).toBe(firstWakeupId); // Same wakeup ID
      expect(wakeups2[0].coalescedCount).toBe(firstCoalescedCount + 1);
    } finally {
      const db = server.context.db as any;
      await new Promise(r => setTimeout(r, 100));
      if (db.end) {
        try {
          await db.end();
        } catch {
          // Suppress CONNECTION_ENDED errors during cleanup
        }
      }
      await server.close();
    }
  }, 180000);

  it("assignTask with wake=true to paused agent returns agent_not_invokable", async () => {
    const server = await boot();
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // Setup: tenant, paused agent, task
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Paused Agent Test", slug: "paused-agent-test" });

      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Paused Agent",
        role: "engineer",
        status: "paused",
      });

      const createRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          title: "Task for paused agent",
          priority: "medium",
          originKind: "manual",
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // Try to wake a paused agent
      const assignRes = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({ agentId, wake: true }),
      });
      expect(assignRes.status).toBe(200);
      const result = (await assignRes.json()) as { assigned: boolean; wakeup?: { kind: string; agentStatus?: string } };
      expect(result.assigned).toBe(true); // Task still assigned
      expect(result.wakeup?.kind).toBe("agent_not_invokable");
      expect(result.wakeup?.agentStatus).toBe("paused");
    } finally {
      const db = server.context.db as any;
      await new Promise(r => setTimeout(r, 100));
      if (db.end) {
        try {
          await db.end();
        } catch {
          // Suppress CONNECTION_ENDED errors during cleanup
        }
      }
      await server.close();
    }
  }, 180000);

  it("assignTask with wake=true to archived agent returns agent_not_invokable", async () => {
    const server = await boot();
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;

      // Setup: tenant, archived agent, task
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Archived Agent Test", slug: "archived-agent-test" });

      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Archived Agent",
        role: "engineer",
        status: "archived",
      });

      const createRes = await fetch(`${server.url}/api/admin/tasks`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({
          title: "Task for archived agent",
          priority: "medium",
          originKind: "manual",
        }),
      });
      const created = (await createRes.json()) as { id: string };
      const taskId = created.id;

      // Try to wake an archived agent
      const assignRes = await fetch(`${server.url}/api/admin/tasks/${taskId}/assign`, {
        method: "POST",
        headers: headers(tenantId),
        body: JSON.stringify({ agentId, wake: true }),
      });
      expect(assignRes.status).toBe(200);
      const result = (await assignRes.json()) as { assigned: boolean; wakeup?: { kind: string; agentStatus?: string } };
      expect(result.assigned).toBe(true); // Task still assigned
      expect(result.wakeup?.kind).toBe("agent_not_invokable");
      expect(result.wakeup?.agentStatus).toBe("archived");
    } finally {
      const db = server.context.db as any;
      await new Promise(r => setTimeout(r, 100));
      if (db.end) {
        try {
          await db.end();
        } catch {
          // Suppress CONNECTION_ENDED errors during cleanup
        }
      }
      await server.close();
    }
  }, 180000);
});

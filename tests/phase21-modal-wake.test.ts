/**
 * Phase 21 Smoke Tests — New Task Modal "Wake the agent now"
 *
 * Tests that the NewTaskModal's "Wake the agent now" checkbox actually fires
 * a wake event when creating a task and assigning it to an agent.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "modal-wake-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-modal-"));
  return new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

function headers(tenantId: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tenantId };
}

describe("NewTaskModal: wake fires", () => {
  it("assignTask with wake=true creates and enqueues wakeup request", async () => {
    const server = await boot(5570);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks, runtimes, agentWakeupRequests } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // 1. Create tenant
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "Modal Test", slug: "modal-test" });

      // 2. Create a command runtime
      const runtimeId = generateId();
      const dataDir = await mkdtemp(join(tmpdir(), "boringos-modal-runtime-"));
      const scriptPath = join(dataDir, "test-agent.sh");
      await writeFile(scriptPath, "#!/bin/bash\nexit 0\n");
      await chmod(scriptPath, 0o755);

      await db.insert(runtimes).values({
        id: runtimeId,
        tenantId,
        name: "test-runtime",
        type: "command",
        config: { command: scriptPath },
      });

      // 3. Create agent
      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Agent",
        role: "engineer",
        runtimeId,
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
      await server.close();
    }
  }, 30000);

  it("assignTask without wake does not create wakeup request", async () => {
    const server = await boot(5569);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks, runtimes, agentWakeupRequests } = await import("@boringos/db");
      const { eq } = await import("drizzle-orm");
      const db = server.context.db as import("@boringos/db").Db;

      // Setup: tenant, runtime, agent
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "No Wake Test", slug: "no-wake-test" });

      const runtimeId = generateId();
      const dataDir = await mkdtemp(join(tmpdir(), "boringos-no-wake-"));
      const scriptPath = join(dataDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\nexit 0\n");
      await chmod(scriptPath, 0o755);

      await db.insert(runtimes).values({
        id: runtimeId,
        tenantId,
        name: "test-runtime",
        type: "command",
        config: { command: scriptPath },
      });

      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Agent",
        role: "engineer",
        runtimeId,
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
      await server.close();
    }
  }, 30000);
});

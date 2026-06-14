/**
 * Unit tests for wakeup coalescing behavior.
 *
 * Tests the createWakeup function's core logic:
 * - Coalescing: (agent, task) pair deduplication
 * - Non-coalescing: different tasks get independent wakeups
 * - Edge cases: no taskId, paused/archived agents, multiple coalescences
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

// Suppress CONNECTION_ENDED errors from postgres library cleanup
process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === "CONNECTION_ENDED" || reason?.errno === "CONNECTION_ENDED") {
    return;
  }
  throw reason;
});

const tempDirs: string[] = [];

describe("createWakeup — coalescing", () => {
  let db: import("@boringos/db").Db;
  let app: import("@boringos/core").BoringOS;
  let tenantId: string;
  let agentId: string;
  let otherAgentId: string;

  beforeAll(async () => {
    const { BoringOS } = await import("@boringos/core");
    const dataDir = await mkdtemp(join(tmpdir(), "boringos-coalesce-"));
    tempDirs.push(dataDir);

    const randomPort = 5500 + Math.floor(Math.random() * 1000);
    app = new BoringOS({
      database: { embedded: true, dataDir, port: randomPort },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "test-secret-coalesce" },
    });
    const server = await app.listen(0);
    db = (server as unknown as { context: { db: import("@boringos/db").Db } }).context.db;

    const { tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    // Create tenant and agents with fresh IDs
    tenantId = generateId();
    agentId = generateId();
    otherAgentId = generateId();

    await db
      .insert(tenants)
      .values({ id: tenantId, name: "Coalesce Test Tenant", slug: `coalesce-test-${tenantId}` })
      .onConflictDoNothing();

    // Create two agents (first is root, second reports to first)
    await db
      .insert(agents)
      .values({
        id: agentId,
        tenantId,
        name: "Test Agent 1",
        role: "engineer",
        status: "active",
      })
      .onConflictDoNothing();

    await db
      .insert(agents)
      .values({
        id: otherAgentId,
        tenantId,
        name: "Test Agent 2",
        role: "engineer",
        status: "active",
        reportsTo: agentId,
      })
      .onConflictDoNothing();
  }, 120000);

  afterAll(async () => {
    await app?.close?.();
    await new Promise((r) => setTimeout(r, 2000));
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await rm(dir, { recursive: true, force: true });
          break;
        } catch (e) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
    }
  }, 20000);

  beforeEach(async () => {
    // Clean up wakeup requests before each test
    const { agentWakeupRequests } = await import("@boringos/db");
    await db.delete(agentWakeupRequests);
  });

  it("creates a new wakeup request when none exists", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();
    const result = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "test_reason",
      taskId,
    });

    expect(result.kind).toBe("created");
    expect(result.wakeupRequestId).toBeDefined();

    // Verify it was inserted
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, result.wakeupRequestId!));
    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe(agentId);
    expect(rows[0].taskId).toBe(taskId);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].coalescedCount).toBe(0);
  });

  it("coalesces when same (agent, task) pair requests wakeup twice", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();

    // First wake
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "first_wake",
      taskId,
    });

    expect(result1.kind).toBe("created");
    const firstWakeupId = result1.wakeupRequestId!;

    // Verify first wakeup
    let rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0].coalescedCount).toBe(0);

    // Second wake — should coalesce
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "second_wake",
      taskId,
    });

    expect(result2.kind).toBe("coalesced");
    expect(result2.existingWakeupRequestId).toBe(firstWakeupId);

    // Verify count incremented, still one row
    rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstWakeupId);
    expect(rows[0].coalescedCount).toBe(1);
  });

  it("does not coalesce when same agent has different tasks", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const task1 = generateId();
    const task2 = generateId();

    // Wake for task 1
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "task1_wake",
      taskId: task1,
    });
    expect(result1.kind).toBe("created");

    // Wake for task 2 — should NOT coalesce
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "task2_wake",
      taskId: task2,
    });
    expect(result2.kind).toBe("created");
    expect(result2.wakeupRequestId).not.toBe(result1.wakeupRequestId);

    // Verify two separate wakeup rows exist
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.taskId).sort()).toEqual([task1, task2].sort());
  });

  it("allows concurrent wakeups for same task but different agents", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();

    // Wake agent 1 for task
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "agent1_wake",
      taskId,
    });
    expect(result1.kind).toBe("created");

    // Wake agent 2 for same task — should NOT coalesce (different agent)
    const result2 = await createWakeup(db, {
      agentId: otherAgentId,
      tenantId,
      reason: "agent2_wake",
      taskId,
    });
    expect(result2.kind).toBe("created");
    expect(result2.wakeupRequestId).not.toBe(result1.wakeupRequestId);

    // Verify two separate rows
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows).toHaveLength(2);
  });

  it("handles wakeup without taskId (agent-level wake)", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");

    // Wake without taskId (agent-level)
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "agent_wake_no_task",
      // taskId omitted
    });
    expect(result1.kind).toBe("created");

    const firstWakeupId = result1.wakeupRequestId!;

    // Second wake without taskId — should NOT coalesce because no taskId comparison
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "second_agent_wake_no_task",
    });
    expect(result2.kind).toBe("created");
    expect(result2.wakeupRequestId).not.toBe(firstWakeupId);

    // Verify two rows (no coalescing without taskId)
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
    const noTaskRows = rows.filter((r) => r.taskId === null);
    expect(noTaskRows.length).toBeGreaterThanOrEqual(2);
  });

  it("returns agent_not_found when agent does not exist", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { generateId } = await import("@boringos/shared");

    const fakeAgentId = generateId();
    const taskId = generateId();

    const result = await createWakeup(db, {
      agentId: fakeAgentId,
      tenantId,
      reason: "fake_agent",
      taskId,
    });

    expect(result.kind).toBe("agent_not_found");
  });

  it("returns agent_not_invokable when agent is paused", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const pausedAgentId = generateId();
    const taskId = generateId();

    // Create paused agent (reports to root agent)
    await db.insert(agents).values({
      id: pausedAgentId,
      tenantId,
      name: "Paused Agent",
      role: "engineer",
      status: "paused",
      reportsTo: agentId,
    });

    const result = await createWakeup(db, {
      agentId: pausedAgentId,
      tenantId,
      reason: "paused_agent_wake",
      taskId,
    });

    expect(result.kind).toBe("agent_not_invokable");
    expect(result.agentStatus).toBe("paused");
  });

  it("returns agent_not_invokable when agent is archived", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const archivedAgentId = generateId();
    const taskId = generateId();

    // Create archived agent (reports to root agent)
    await db.insert(agents).values({
      id: archivedAgentId,
      tenantId,
      name: "Archived Agent",
      role: "engineer",
      status: "archived",
      reportsTo: agentId,
    });

    const result = await createWakeup(db, {
      agentId: archivedAgentId,
      tenantId,
      reason: "archived_agent_wake",
      taskId,
    });

    expect(result.kind).toBe("agent_not_invokable");
    expect(result.agentStatus).toBe("archived");
  });

  it("increments coalescedCount correctly through multiple wakeups", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();

    // First wake
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake1",
      taskId,
    });
    expect(result1.kind).toBe("created");

    let rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows[0].coalescedCount).toBe(0);

    // Second wake
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake2",
      taskId,
    });
    expect(result2.kind).toBe("coalesced");

    rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows[0].coalescedCount).toBe(1);

    // Third wake
    const result3 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake3",
      taskId,
    });
    expect(result3.kind).toBe("coalesced");

    rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows[0].coalescedCount).toBe(2);

    // Verify only one row exists
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("coalesces only pending wakeups, not consumed or failed ones", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();

    // Create first wakeup
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake1",
      taskId,
    });
    expect(result1.kind).toBe("created");

    // Mark it as consumed
    await db
      .update(agentWakeupRequests)
      .set({ status: "consumed" })
      .where(eq(agentWakeupRequests.id, result1.wakeupRequestId!));

    // Second wake should create a NEW one (not coalesce the consumed one)
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake2",
      taskId,
    });
    expect(result2.kind).toBe("created");
    expect(result2.wakeupRequestId).not.toBe(result1.wakeupRequestId);

    // Verify two rows exist
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["consumed", "pending"].sort());
  });

  it("uses payload parameter when creating wakeup", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    const taskId = generateId();
    const payload = { customField: "customValue", nested: { value: 42 } };

    const result = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake_with_payload",
      taskId,
      payload,
    });

    expect(result.kind).toBe("created");

    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, result.wakeupRequestId!));

    expect(rows[0].payload).toEqual(payload);
  });
});

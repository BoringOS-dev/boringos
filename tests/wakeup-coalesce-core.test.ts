/**
 * Core wakeup coalescing test — minimal setup to validate the feature works.
 * This test focuses on the createWakeup function's logic without relying on
 * embedded Postgres overhead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === "CONNECTION_ENDED" || reason?.errno === "CONNECTION_ENDED") {
    return;
  }
  throw reason;
});

describe("BOS-001: Wakeup coalescing core functionality", () => {
  let db: any;
  let app: any;
  let dataDir: string;
  let tenantId: string;
  let agentId: string;

  beforeAll(async () => {
    const { BoringOS } = await import("@boringos/core");
    dataDir = await mkdtemp(join(tmpdir(), "boringos-coalesce-core-"));

    // Use a very specific port to avoid conflicts
    const randomPort = 6000 + Math.floor(Math.random() * 100);

    let retries = 0;
    while (retries < 3) {
      try {
        app = new BoringOS({
          database: { embedded: true, dataDir, port: randomPort },
          drive: { root: join(dataDir, "drive") },
          auth: { secret: "test-secret-core" },
        });
        const server = await app.listen(0);
        db = server.context.db;
        break;
      } catch (err) {
        retries++;
        if (retries >= 3) throw err;
        // Clean up and retry
        try {
          await app?.close?.();
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const { tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    tenantId = generateId();
    agentId = generateId();

    await db.insert(tenants).values({
      id: tenantId,
      name: "BOS-001 Core Test",
      slug: `bos001-core-${tenantId.substring(0, 8)}`
    });

    await db.insert(agents).values({
      id: agentId,
      tenantId,
      name: "Test Agent",
      role: "engineer",
      status: "active",
    });
  }, 180000);

  afterAll(async () => {
    try {
      await app?.close?.();
      await new Promise((r) => setTimeout(r, 1000));
      // Aggressive cleanup
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rm(dataDir, { recursive: true, force: true });
          break;
        } catch (e) {
          if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }, 30000);

  it("creates a new wakeup request", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { generateId } = await import("@boringos/shared");

    const taskId = generateId();
    const result = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "test_create",
      taskId,
    });

    expect(result.kind).toBe("created");
    expect(result.wakeupRequestId).toBeDefined();
  });

  it("coalesces duplicate (agent, task) requests", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    await db.delete(agentWakeupRequests);

    const taskId = generateId();

    // First wakeup
    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake1",
      taskId,
    });
    expect(result1.kind).toBe("created");
    const firstId = result1.wakeupRequestId;

    // Second wakeup — should coalesce
    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake2",
      taskId,
    });
    expect(result2.kind).toBe("coalesced");
    expect(result2.existingWakeupRequestId).toBe(firstId);

    // Verify exactly one row exists with incremented count
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));

    expect(rows).toHaveLength(1);
    expect(rows[0].coalescedCount).toBe(1);
  });

  it("validates agent exists before creating wakeup", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { generateId } = await import("@boringos/shared");

    const nonexistentAgentId = generateId();
    const taskId = generateId();

    const result = await createWakeup(db, {
      agentId: nonexistentAgentId,
      tenantId,
      reason: "invalid_agent",
      taskId,
    });

    expect(result.kind).toBe("agent_not_found");
  });

  it("rejects wakeup for paused agents", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const pausedAgentId = generateId();
    const taskId = generateId();

    // Create a paused agent
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
      reason: "paused_wake",
      taskId,
    });

    expect(result.kind).toBe("agent_not_invokable");
    expect(result.agentStatus).toBe("paused");
  });

  it("tracks coalesced count through multiple wakeups", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    await db.delete(agentWakeupRequests);

    const taskId = generateId();
    const wakeIds = [];

    // Create 3 wakeup requests for the same task
    for (let i = 0; i < 3; i++) {
      const result = await createWakeup(db, {
        agentId,
        tenantId,
        reason: `wake${i}`,
        taskId,
      });

      if (i === 0) {
        expect(result.kind).toBe("created");
        wakeIds.push(result.wakeupRequestId);
      } else {
        expect(result.kind).toBe("coalesced");
        wakeIds.push(result.existingWakeupRequestId);
      }
    }

    // All should reference the same wakeup request
    expect(new Set(wakeIds).size).toBe(1);

    // Verify final coalescence count
    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.taskId, taskId));

    expect(rows).toHaveLength(1);
    expect(rows[0].coalescedCount).toBe(2);
  });

  it("stores custom payload in wakeup request", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { eq } = await import("drizzle-orm");

    await db.delete(agentWakeupRequests);

    const taskId = generateId();
    const customPayload = {
      userId: "user-123",
      priority: "high",
      metadata: { source: "modal" }
    };

    const result = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "wake_with_payload",
      taskId,
      payload: customPayload,
    });

    expect(result.kind).toBe("created");

    const rows = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, result.wakeupRequestId!));

    expect(rows[0].payload).toEqual(customPayload);
  });
});

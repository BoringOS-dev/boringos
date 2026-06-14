/**
 * Simple test for wakeup coalescing to validate setup
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Suppress CONNECTION_ENDED errors from Postgres cleanup
process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === "CONNECTION_ENDED" || reason?.errno === "CONNECTION_ENDED") {
    return;
  }
  throw reason;
});

describe("createWakeup basic test", () => {
  let db: any;
  let app: any;
  let dataDir: string;
  let tenantId: string;
  let agentId: string;

  beforeAll(async () => {
    const { BoringOS } = await import("@boringos/core");
    dataDir = await mkdtemp(join(tmpdir(), "boringos-coalesce-simple-"));
    const randomPort = 5500 + Math.floor(Math.random() * 100);
    app = new BoringOS({
      database: { embedded: true, dataDir, port: randomPort },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "test-secret-simple" },
    });
    const server = await app.listen(0);
    db = server.context.db;

    const { tenants, agents } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    tenantId = generateId();
    agentId = generateId();

    await db.insert(tenants).values({ id: tenantId, name: "Test", slug: "test" });
    await db.insert(agents).values({
      id: agentId,
      tenantId,
      name: "Agent",
      role: "engineer",
      status: "active",
    });
  }, 120000);

  afterAll(async () => {
    try {
      await app?.close?.();
      await new Promise((r) => setTimeout(r, 100));
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates a new wakeup", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const taskId = "task-0001";

    const result = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "test",
      taskId,
    });

    expect(result.kind).toBe("created");
    expect(result.wakeupRequestId).toBeDefined();
  });

  it("coalesces on second wake", async () => {
    const { createWakeup } = await import("@boringos/agent");
    const { agentWakeupRequests } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");

    // Clear any existing
    await db.delete(agentWakeupRequests);

    const taskId = "task-0002";

    const result1 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "first",
      taskId,
    });

    expect(result1.kind).toBe("created");
    const firstId = result1.wakeupRequestId;

    const result2 = await createWakeup(db, {
      agentId,
      tenantId,
      reason: "second",
      taskId,
    });

    expect(result2.kind).toBe("coalesced");
    expect(result2.existingWakeupRequestId).toBe(firstId);
  });
});

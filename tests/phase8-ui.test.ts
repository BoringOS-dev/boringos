/**
 * Phase 8 Smoke Tests — UI Package (API Client + List Endpoints)
 *
 * Tests the typed API client against a running BoringOS server,
 * and verifies the new list endpoints (agents, tasks, runs).
 */
import { describe, it, expect } from "vitest";

describe("@boringos/ui: API client", () => {
  it("createBoringOSClient hits /health", async () => {
    const { createBoringOSClient } = await import("@boringos/ui");
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-ui-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5590 },
      drive: { root: join(dataDir, "drive") },
    });
    const server = await app.listen(0);

    try {
      const client = createBoringOSClient({ url: server.url });
      const health = await client.health();
      expect(health.status).toBe("ok");
      expect(health.timestamp).toBeTruthy();
    } finally {
      await server.close();
    }
  }, 30000);

  it("list endpoints return data with valid JWT", async () => {
    const { createBoringOSClient } = await import("@boringos/ui");
    const { BoringOS } = await import("@boringos/core");
    const { signCallbackToken } = await import("@boringos/agent");
    const { tenants, agents: agentsTable, tasks: tasksTable } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-ui2-"));
    const secret = "ui-test-secret";
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5589 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret },
    });
    const server = await app.listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;

      // Create test data
      const tenantId = generateId();
      const agentId = generateId();
      const taskId = generateId();

      await db.insert(tenants).values({ id: tenantId, name: "UI Test", slug: "ui-test" });
      await db.insert(agentsTable).values({ id: agentId, tenantId, name: "UI Agent", role: "engineer" });
      await db.insert(tasksTable).values({
        id: taskId, tenantId, title: "UI Task", status: "todo", priority: "medium",
        assigneeAgentId: agentId, originKind: "manual",
      });

      const token = signCallbackToken({ runId: generateId(), agentId, tenantId }, secret);
      const client = createBoringOSClient({ url: server.url, token });

      // List agents
      const agents = await client.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("UI Agent");

      // List tasks
      const tasks = await client.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("UI Task");

      // Get single task
      const taskDetail = await client.getTask(taskId);
      expect(taskDetail.task.title).toBe("UI Task");
      expect(taskDetail.comments).toHaveLength(0);

      // Post comment
      const comment = await client.postComment(taskId, { body: "Hello from UI" });
      expect(comment.id).toBeTruthy();

      // Verify comment shows up
      const taskAfter = await client.getTask(taskId);
      expect(taskAfter.comments).toHaveLength(1);
      expect(taskAfter.comments[0].body).toBe("Hello from UI");

      // List runs (empty)
      const runs = await client.getRuns();
      expect(runs).toHaveLength(0);
    } finally {
      await server.close();
    }
  }, 30000);
});

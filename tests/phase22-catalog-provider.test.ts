/**
 * Phase 22 — Catalog Provider Test
 *
 * Verifies that the connector-actions catalog appears in the agent's system prompt.
 * Tests that agents can discover their available tools automatically.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("catalog provider: connector-actions catalog appears in prompt", () => {
  it("agent receives connector actions catalog in system prompt", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { google } = await import("@boringos/connector-google");
    const { tenants, agents, tasks, runtimes, agentRuns, connectors } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");
    const { generateId } = await import("@boringos/shared");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-catalog-test-"));
    const stdinCapture = join(dataDir, "captured-stdin.txt");

    // Create a script that captures stdin to file
    const scriptPath = join(dataDir, "test-agent.sh");
    await writeFile(scriptPath, [
      "#!/bin/bash",
      `cat > "${stdinCapture}"`,
      "exit 0",
    ].join("\n"));
    await chmod(scriptPath, 0o755);

    // Boot BoringOS with Google connector registered via .connector()
    const app = new BoringOS({
      database: { embedded: true, dataDir: join(dataDir, "pg"), port: 5597 },
      drive: { root: join(dataDir, "drive") },
    });

    app.connector(google({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    }));

    const server = await app.listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;

      // 1. Create tenant
      const tenantId = generateId();
      await db.insert(tenants).values({
        id: tenantId,
        name: "Test Corp",
        slug: "test-corp",
      });

      // 2. Connect the Google connector for this tenant
      const connectorId = generateId();
      await db.insert(connectors).values({
        id: connectorId,
        tenantId,
        kind: "google",
        name: "Google Workspace",
        status: "active",
        config: {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        },
      });

      // 3. Create a command runtime that runs our test script
      const runtimeId = generateId();
      await db.insert(runtimes).values({
        id: runtimeId,
        tenantId,
        name: "test-script",
        type: "command",
        config: { command: scriptPath },
      });

      // 4. Create agent
      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Engineer",
        role: "engineer",
        instructions: "Focus on writing clean code with tests.",
        runtimeId,
      });

      // 5. Create task
      const taskId = generateId();
      await db.insert(tasks).values({
        id: taskId,
        tenantId,
        title: "Send notification email",
        description: "Send an email notification to the user.",
        status: "todo",
        priority: "high",
        assigneeAgentId: agentId,
        identifier: "AR-001",
        originKind: "manual",
      });

      // 6. Wake the agent
      const engine = server.context.agentEngine!;
      const outcome = await engine.wake({
        agentId,
        tenantId,
        reason: "manual_request",
        taskId,
      });

      expect(outcome.kind).toBe("created");
      const wakeupId = (outcome as { kind: "created"; wakeupRequestId: string }).wakeupRequestId;

      // 7. Enqueue and wait for execution
      await engine.enqueue(wakeupId);

      // Wait for the in-process queue to finish (poll for run completion)
      let attempts = 0;
      let runStatus = "queued";
      while (attempts < 20 && runStatus !== "done" && runStatus !== "failed") {
        await new Promise((r) => setTimeout(r, 200));
        const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agentId)).limit(1);
        runStatus = runs[0]?.status ?? "queued";
        attempts++;
      }

      // 8. Verify run completed
      const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agentId)).limit(1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("done");
      expect(runs[0].exitCode).toBe(0);

      // 9. Verify the catalog appears in the system prompt
      const capturedStdin = await readFile(stdinCapture, "utf8");

      // Check for the catalog header
      expect(capturedStdin).toContain("## Available tools — connector actions");

      // Check for Google connector section
      expect(capturedStdin).toContain("### Google Workspace (`google`)");

      // Check for specific Google actions
      expect(capturedStdin).toContain("google.send_email");
      expect(capturedStdin).toContain("Send an email");
      expect(capturedStdin).toContain("curl -sS -X POST");
      expect(capturedStdin).toContain("api/connectors/actions/google/send_email");

      // Verify it mentions the authorization method
      expect(capturedStdin).toContain("BORINGOS_CALLBACK_TOKEN");
    } finally {
      await server.close();
    }
  }, 60000);

  it("catalog is empty when no connectors are connected", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { google } = await import("@boringos/connector-google");
    const { tenants, agents, tasks, runtimes, agentRuns } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");
    const { generateId } = await import("@boringos/shared");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-catalog-empty-test-"));
    const stdinCapture = join(dataDir, "captured-stdin.txt");

    // Create a script that captures stdin to file
    const scriptPath = join(dataDir, "test-agent.sh");
    await writeFile(scriptPath, [
      "#!/bin/bash",
      `cat > "${stdinCapture}"`,
      "exit 0",
    ].join("\n"));
    await chmod(scriptPath, 0o755);

    // Boot BoringOS with Google connector registered via .connector()
    // (but don't connect it for the tenant)
    const app = new BoringOS({
      database: { embedded: true, dataDir: join(dataDir, "pg"), port: 5598 },
      drive: { root: join(dataDir, "drive") },
    });

    app.connector(google({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    }));

    const server = await app.listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;

      // 1. Create tenant (without connecting any connectors)
      const tenantId = generateId();
      await db.insert(tenants).values({
        id: tenantId,
        name: "Test Corp",
        slug: "test-corp",
      });

      // 2. Create a command runtime that runs our test script
      const runtimeId = generateId();
      await db.insert(runtimes).values({
        id: runtimeId,
        tenantId,
        name: "test-script",
        type: "command",
        config: { command: scriptPath },
      });

      // 3. Create agent
      const agentId = generateId();
      await db.insert(agents).values({
        id: agentId,
        tenantId,
        name: "Test Engineer",
        role: "engineer",
        instructions: "Focus on writing clean code with tests.",
        runtimeId,
      });

      // 4. Create task
      const taskId = generateId();
      await db.insert(tasks).values({
        id: taskId,
        tenantId,
        title: "Some task",
        description: "Do something.",
        status: "todo",
        priority: "high",
        assigneeAgentId: agentId,
        identifier: "AR-001",
        originKind: "manual",
      });

      // 5. Wake the agent
      const engine = server.context.agentEngine!;
      const outcome = await engine.wake({
        agentId,
        tenantId,
        reason: "manual_request",
        taskId,
      });

      expect(outcome.kind).toBe("created");
      const wakeupId = (outcome as { kind: "created"; wakeupRequestId: string }).wakeupRequestId;

      // 6. Enqueue and wait for execution
      await engine.enqueue(wakeupId);

      // Wait for the in-process queue to finish (poll for run completion)
      let attempts = 0;
      let runStatus = "queued";
      while (attempts < 20 && runStatus !== "done" && runStatus !== "failed") {
        await new Promise((r) => setTimeout(r, 200));
        const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agentId)).limit(1);
        runStatus = runs[0]?.status ?? "queued";
        attempts++;
      }

      // 7. Verify run completed
      const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agentId)).limit(1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("done");

      // 8. Verify the catalog section is NOT in the system prompt
      // (since no connectors are connected for this tenant)
      const capturedStdin = await readFile(stdinCapture, "utf8");
      expect(capturedStdin).not.toContain("## Available tools — connector actions");
      expect(capturedStdin).not.toContain("google.send_email");
    } finally {
      await server.close();
    }
  }, 60000);
});

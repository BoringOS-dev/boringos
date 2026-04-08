/**
 * Phase 3 — Golden Integration Test
 *
 * Proves the full agent execution loop end-to-end:
 * Boot → Create tenant/agent/task → Wake → Execute → Verify context → Verify completion
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("golden: full agent execution", () => {
  it("agent wakes, receives context, executes, and completes", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { tenants, agents, tasks, runtimes, agentRuns } = await import("@boringos/db");
    const { eq } = await import("drizzle-orm");
    const { generateId } = await import("@boringos/shared");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-golden-"));
    const stdinCapture = join(dataDir, "captured-stdin.txt");
    const envCapture = join(dataDir, "captured-env.txt");

    // Create a script that captures stdin and env vars to files
    const scriptPath = join(dataDir, "test-agent.sh");
    await writeFile(scriptPath, [
      "#!/bin/bash",
      `cat > "${stdinCapture}"`,
      `env | grep BORINGOS > "${envCapture}"`,
      "exit 0",
    ].join("\n"));
    await chmod(scriptPath, 0o755);

    // Boot BoringOS
    const app = new BoringOS({
      database: { embedded: true, dataDir: join(dataDir, "pg"), port: 5596 },
      drive: { root: join(dataDir, "drive") },
    });

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
        title: "Implement user authentication",
        description: "Add JWT-based auth to the API. Include login, logout, and token refresh endpoints.",
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
      expect(runs[0].exitCode).toBe(0);

      // 8. Verify the agent subprocess received context via stdin
      const capturedStdin = await readFile(stdinCapture, "utf8");
      expect(capturedStdin).toContain("AR-001");
      expect(capturedStdin).toContain("Implement user authentication");
      expect(capturedStdin).toContain("JWT-based auth");

      // 9. Verify env vars were injected
      const capturedEnv = await readFile(envCapture, "utf8");
      expect(capturedEnv).toContain("BORINGOS_AGENT_ID");
      expect(capturedEnv).toContain("BORINGOS_TENANT_ID");
      expect(capturedEnv).toContain("BORINGOS_RUN_ID");

    } finally {
      await server.close();
    }
  }, 60000);
});

/**
 * BoringOS Quickstart
 *
 * Boots an BoringOS server, creates a tenant and agent,
 * assigns a task, and watches the agent execute.
 *
 * Run: npx tsx index.ts
 */
import { BoringOS } from "@boringos/core";
import { tenants, agents, tasks, runtimes, agentRuns } from "@boringos/db";
import { generateId } from "@boringos/shared";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Booting BoringOS...");

  const app = new BoringOS({});
  const server = await app.listen(3000);

  console.log(`Server running at ${server.url}`);
  console.log(`Health check: ${server.url}/health`);

  const db = server.context.db as import("@boringos/db").Db;

  // 1. Create a tenant
  const tenantId = generateId();
  await db.insert(tenants).values({
    id: tenantId,
    name: "Acme Corp",
    slug: "acme-corp",
  });
  console.log(`\nCreated tenant: Acme Corp (${tenantId})`);

  // 2. Create a runtime that uses 'echo' (works without any AI CLI)
  const runtimeId = generateId();
  await db.insert(runtimes).values({
    id: runtimeId,
    tenantId,
    name: "echo-agent",
    type: "command",
    config: { command: "cat" }, // cat reads stdin and prints it — proves context delivery
  });

  // 3. Create an agent
  const agentId = generateId();
  await db.insert(agents).values({
    id: agentId,
    tenantId,
    name: "Code Bot",
    role: "engineer",
    instructions: "You are a helpful coding agent.",
    runtimeId,
  });
  console.log(`Created agent: Code Bot (${agentId})`);

  // 4. Create a task
  const taskId = generateId();
  await db.insert(tasks).values({
    id: taskId,
    tenantId,
    title: "Add health endpoint",
    description: "Add a GET /health endpoint that returns { status: 'ok' }.",
    status: "todo",
    priority: "medium",
    assigneeAgentId: agentId,
    identifier: "ACME-001",
    originKind: "manual",
  });
  console.log(`Created task: ACME-001 — Add health endpoint`);

  // 5. Wake the agent
  const engine = server.context.agentEngine!;
  const outcome = await engine.wake({
    agentId,
    tenantId,
    reason: "manual_request",
    taskId,
  });

  if (outcome.kind === "created") {
    console.log(`\nAgent woken! Wakeup ID: ${outcome.wakeupRequestId}`);
    await engine.enqueue(outcome.wakeupRequestId);

    // Wait for completion
    console.log("Waiting for agent to finish...\n");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, agentId)).limit(1);
      if (runs[0]?.status === "done" || runs[0]?.status === "failed") {
        console.log(`Run completed — status: ${runs[0].status}, exit code: ${runs[0].exitCode}`);
        if (runs[0].stdoutExcerpt) {
          console.log("\n--- Agent received this context (first 500 chars) ---");
          console.log(runs[0].stdoutExcerpt.slice(0, 500));
          console.log("---");
        }
        break;
      }
    }
  }

  console.log("\nServer still running at", server.url);
  console.log("Press Ctrl+C to stop.");
}

main().catch(console.error);

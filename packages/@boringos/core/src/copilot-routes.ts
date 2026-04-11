import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { tasks, taskComments, agents } from "@boringos/db";
import type { AgentEngine } from "@boringos/agent";
import { generateId } from "@boringos/shared";

/**
 * Copilot session routes.
 *
 * Sessions are tasks with originKind="copilot".
 * Messages are comments on those tasks.
 * Posting a message auto-wakes the copilot agent.
 */
export function createCopilotRoutes(db: Db, engine: AgentEngine, tenantId: string): Hono {
  const app = new Hono();

  // Find or create the copilot agent for this tenant
  async function getCopilotAgentId(): Promise<string | null> {
    const rows = await db.select().from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.role, "copilot")))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // POST /sessions — create a new copilot session
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const id = generateId();
    const title = (body.title as string) || `Copilot — ${new Date().toLocaleDateString()}`;

    await db.insert(tasks).values({
      id,
      tenantId,
      title,
      status: "in_progress",
      priority: "medium",
      originKind: "copilot",
    });

    return c.json({ id, title }, 201);
  });

  // GET /sessions — list copilot sessions
  app.get("/sessions", async (c) => {
    const rows = await db.select().from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.originKind, "copilot")))
      .orderBy(desc(tasks.createdAt));

    return c.json({ sessions: rows });
  });

  // GET /sessions/:id — get session with messages
  app.get("/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");

    const taskRows = await db.select().from(tasks)
      .where(and(eq(tasks.id, sessionId), eq(tasks.tenantId, tenantId)))
      .limit(1);

    if (!taskRows[0]) return c.json({ error: "Session not found" }, 404);

    const comments = await db.select().from(taskComments)
      .where(eq(taskComments.taskId, sessionId))
      .orderBy(taskComments.createdAt);

    return c.json({
      session: taskRows[0],
      messages: comments.map((c) => ({
        id: c.id,
        body: c.body,
        role: c.authorAgentId ? "assistant" : "user",
        agentId: c.authorAgentId,
        createdAt: c.createdAt,
      })),
    });
  });

  // POST /sessions/:id/message — post user message + auto-wake copilot
  app.post("/sessions/:id/message", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json() as Record<string, unknown>;
    const message = body.message as string;

    if (!message?.trim()) return c.json({ error: "message is required" }, 400);

    // Verify session exists
    const taskRows = await db.select().from(tasks)
      .where(and(eq(tasks.id, sessionId), eq(tasks.tenantId, tenantId)))
      .limit(1);
    if (!taskRows[0]) return c.json({ error: "Session not found" }, 404);

    // Post user message as comment
    const commentId = generateId();
    await db.insert(taskComments).values({
      id: commentId,
      taskId: sessionId,
      tenantId,
      body: message,
    });

    // Auto-wake copilot agent
    const copilotId = await getCopilotAgentId();
    if (!copilotId) {
      return c.json({ id: commentId, error: "Copilot agent not found — run seed or create a copilot agent" }, 201);
    }

    // Assign task to copilot if not already
    if (taskRows[0].assigneeAgentId !== copilotId) {
      await db.update(tasks).set({ assigneeAgentId: copilotId }).where(eq(tasks.id, sessionId));
    }

    const outcome = await engine.wake({
      agentId: copilotId,
      tenantId,
      reason: "comment_posted",
      taskId: sessionId,
    });

    if (outcome.kind === "created") {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return c.json({ id: commentId, agentWoken: true }, 201);
  });

  // DELETE /sessions/:id — archive session
  app.delete("/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    await db.update(tasks).set({ status: "done" })
      .where(and(eq(tasks.id, sessionId), eq(tasks.tenantId, tenantId)));
    return c.json({ ok: true });
  });

  return app;
}

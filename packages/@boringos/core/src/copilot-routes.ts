import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { tasks, taskComments, agents } from "@boringos/db";
import type { AgentEngine } from "@boringos/agent";
import { generateId } from "@boringos/shared";

/**
 * Copilot session routes — multi-tenant.
 *
 * Sessions are tasks with originKind="copilot".
 * Messages are comments on those tasks.
 * Posting a message auto-wakes the copilot agent.
 *
 * Tenant resolved from session token (Authorization: Bearer) or X-Tenant-Id header.
 */
type CopilotEnv = { Variables: { tenantId: string; userId: string } };

export function createCopilotRoutes(db: Db, engine: AgentEngine): Hono<CopilotEnv> {
  const app = new Hono<CopilotEnv>();

  // Auth middleware — resolve tenant from session
  app.use("/*", async (c, next) => {
    // Try X-Tenant-Id first (from admin API key auth)
    const headerTenant = c.req.header("X-Tenant-Id");
    if (headerTenant) {
      c.set("tenantId", headerTenant);
      c.set("userId", "");
      return next();
    }

    // Resolve from session token
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!bearer) return c.json({ error: "Authentication required" }, 401);

    const result = await db.execute(sql`
      SELECT s.user_id, ut.tenant_id, ut.role
      FROM auth_sessions s
      JOIN user_tenants ut ON ut.user_id = s.user_id
      WHERE s.token = ${bearer} AND s.expires_at > NOW()
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ user_id: string; tenant_id: string; role: string }>;
    if (!rows[0]) return c.json({ error: "Invalid or expired session" }, 401);

    c.set("tenantId", rows[0].tenant_id);
    c.set("userId", rows[0].user_id);
    return next();
  });

  function getTenantId(c: { get(key: "tenantId"): string }): string {
    return c.get("tenantId");
  }

  async function getCopilotAgentId(tenantId: string): Promise<string | null> {
    const rows = await db.select().from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.role, "copilot")))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // POST /sessions — create a new copilot session
  app.post("/sessions", async (c) => {
    const tenantId = getTenantId(c);
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
    const tenantId = getTenantId(c);
    const rows = await db.select().from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.originKind, "copilot")))
      .orderBy(desc(tasks.createdAt));

    return c.json({ sessions: rows });
  });

  // GET /sessions/:id — get session with messages
  app.get("/sessions/:id", async (c) => {
    const tenantId = getTenantId(c);
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
      messages: comments.map((cm) => ({
        id: cm.id,
        body: cm.body,
        role: cm.authorAgentId ? "assistant" : "user",
        agentId: cm.authorAgentId,
        createdAt: cm.createdAt,
      })),
    });
  });

  // POST /sessions/:id/message — post user message + auto-wake copilot
  app.post("/sessions/:id/message", async (c) => {
    const tenantId = getTenantId(c);
    const sessionId = c.req.param("id");
    const body = await c.req.json() as Record<string, unknown>;
    const message = body.message as string;

    if (!message?.trim()) return c.json({ error: "message is required" }, 400);

    const taskRows = await db.select().from(tasks)
      .where(and(eq(tasks.id, sessionId), eq(tasks.tenantId, tenantId)))
      .limit(1);
    if (!taskRows[0]) return c.json({ error: "Session not found" }, 404);

    const commentId = generateId();
    await db.insert(taskComments).values({
      id: commentId,
      taskId: sessionId,
      tenantId,
      body: message,
    });

    const copilotId = await getCopilotAgentId(tenantId);
    if (!copilotId) {
      return c.json({ id: commentId, error: "Copilot agent not found" }, 201);
    }

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
    const tenantId = getTenantId(c);
    const sessionId = c.req.param("id");
    await db.update(tasks).set({ status: "done" })
      .where(and(eq(tasks.id, sessionId), eq(tasks.tenantId, tenantId)));
    return c.json({ ok: true });
  });

  return app;
}

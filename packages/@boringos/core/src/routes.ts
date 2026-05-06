import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tasks,
  taskComments,
  taskWorkProducts,
  costEvents,
  agents,
  inboxItems,
} from "@boringos/db";
import type { AgentEngine } from "@boringos/agent";
import { verifyCallbackToken } from "@boringos/agent";
import type { CallbackTokenClaims } from "@boringos/agent";
import { generateId } from "@boringos/shared";

type AuthEnv = {
  Variables: {
    claims: CallbackTokenClaims;
  };
};

export function createCallbackRoutes(db: Db, _engine: AgentEngine, jwtSecret: string): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // JWT auth middleware — all callback routes require a valid token
  app.use("/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    const claims = verifyCallbackToken(token, jwtSecret);
    if (!claims) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    c.set("claims", claims);
    await next();
  });

  // GET /agents — list agents for tenant
  app.get("/agents", async (c) => {
    const claims = c.get("claims");
    const rows = await db.select().from(agents).where(eq(agents.tenantId, claims.tenant_id));
    return c.json({ agents: rows });
  });

  // GET /tasks — list tasks for tenant
  app.get("/tasks", async (c) => {
    const claims = c.get("claims");
    const rows = await db.select().from(tasks).where(eq(tasks.tenantId, claims.tenant_id));
    return c.json({ tasks: rows });
  });

  // GET /runs — list runs for tenant
  app.get("/runs", async (c) => {
    const claims = c.get("claims");
    const { agentRuns } = await import("@boringos/db");
    const rows = await db.select().from(agentRuns).where(eq(agentRuns.tenantId, claims.tenant_id));
    return c.json({ runs: rows });
  });

  // GET /tasks/:taskId — read task + comments
  app.get("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const task = taskRows[0];
    if (!task) return c.json({ error: "Task not found" }, 404);

    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, taskId));
    return c.json({ task, comments });
  });

  // PATCH /tasks/:taskId — update task
  app.patch("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const body = await c.req.json() as Record<string, unknown>;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status) updates.status = body.status;
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;

    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
    return c.json({ ok: true });
  });

  // POST /tasks — create task
  //
  // Well-known `originKind` values (string convention, no enum lock-in):
  //   - agent_action  : pre-filled, human approves → executor runs proposedParams
  //   - human_todo    : reminder for the user to do; agent can't do it
  //   - agent_blocked : agent waiting on user input via task comment
  //   - agent_created : default when none supplied
  //   - manual        : human-created
  app.post("/tasks", async (c) => {
    const claims = c.get("claims");
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(tasks).values({
      id,
      tenantId: claims.tenant_id,
      title: body.title as string,
      description: body.description as string | undefined,
      status: (body.status as string) ?? "todo",
      priority: (body.priority as string) ?? "medium",
      parentId: body.parentId as string | undefined,
      assigneeAgentId: body.assigneeAgentId as string | undefined,
      assigneeUserId: body.assigneeUserId as string | undefined,
      createdByAgentId: claims.agent_id,
      originKind: (body.originKind as string) ?? "agent_created",
      proposedParams: body.proposedParams as Record<string, unknown> | undefined,
    });
    return c.json({ id }, 201);
  });

  // POST /tasks/:taskId/comments — post comment
  app.post("/tasks/:taskId/comments", async (c) => {
    const claims = c.get("claims");
    const taskId = c.req.param("taskId");
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(taskComments).values({
      id,
      taskId,
      tenantId: claims.tenant_id,
      body: body.body as string,
      authorAgentId: claims.agent_id,
    });
    return c.json({ id }, 201);
  });

  // POST /tasks/:taskId/work-products — record deliverable
  app.post("/tasks/:taskId/work-products", async (c) => {
    const claims = c.get("claims");
    const taskId = c.req.param("taskId");
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(taskWorkProducts).values({
      id,
      taskId,
      tenantId: claims.tenant_id,
      kind: body.kind as string,
      title: body.title as string,
      url: body.url as string | undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
      createdByAgentId: claims.agent_id,
    });
    return c.json({ id }, 201);
  });

  // POST /runs/:runId/cost — report token usage
  app.post("/runs/:runId/cost", async (c) => {
    const claims = c.get("claims");
    const runId = c.req.param("runId");
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(costEvents).values({
      id,
      tenantId: claims.tenant_id,
      agentId: claims.agent_id,
      runId,
      inputTokens: body.inputTokens as number ?? 0,
      outputTokens: body.outputTokens as number ?? 0,
      model: body.model as string | undefined,
      costUsd: body.costUsd?.toString(),
    });
    return c.json({ ok: true });
  });

  // POST /agents — create agent
  app.post("/agents", async (c) => {
    const claims = c.get("claims");
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(agents).values({
      id,
      tenantId: claims.tenant_id,
      name: body.name as string,
      role: (body.role as string) ?? "general",
      instructions: body.instructions as string | undefined,
    });
    return c.json({ id }, 201);
  });

  // GET /inbox/:itemId — read inbox item
  app.get("/inbox/:itemId", async (c) => {
    const claims = c.get("claims");
    const itemId = c.req.param("itemId");
    const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).limit(1);
    const item = rows[0];
    if (!item) return c.json({ error: "Inbox item not found" }, 404);
    if (item.tenantId !== claims.tenant_id) return c.json({ error: "Forbidden" }, 403);
    return c.json(item);
  });

  // PATCH /inbox/:itemId — update inbox item metadata
  app.patch("/inbox/:itemId", async (c) => {
    const claims = c.get("claims");
    const itemId = c.req.param("itemId");
    const body = await c.req.json() as Record<string, unknown>;

    const itemRows = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).limit(1);
    const item = itemRows[0];
    if (!item) return c.json({ error: "Inbox item not found" }, 404);
    if (item.tenantId !== claims.tenant_id) return c.json({ error: "Forbidden" }, 403);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.metadata) updates.metadata = body.metadata;
    if (body.status) updates.status = body.status;

    await db.update(inboxItems).set(updates).where(eq(inboxItems.id, itemId));
    return c.json({ ok: true });
  });

  return app;
}

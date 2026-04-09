import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import {
  tenants,
  agents,
  tasks,
  taskComments,
  taskWorkProducts,
  agentRuns,
  agentWakeupRequests,
  runtimes,
  approvals,
  costEvents,
  activityLog,
  budgetPolicies,
  budgetIncidents,
  routines,
  companySkills,
  agentSkills,
  projects,
  goals,
  labels,
  taskLabels,
  taskAttachments,
  taskReadStates,
  driveFiles,
  driveSkillRevisions,
  onboardingState,
  evals,
  evalRuns,
  inboxItems,
  entityReferences,
} from "@boringos/db";
import type { AgentEngine } from "@boringos/agent";
import { generateId } from "@boringos/shared";
import type { RealtimeBus } from "./realtime.js";

type AdminEnv = {
  Variables: {
    tenantId: string;
  };
};

export function createAdminRoutes(
  db: Db,
  engine: AgentEngine,
  adminKey: string,
  realtimeBus?: RealtimeBus,
): Hono<AdminEnv> {

  function emit(type: string, tenantId: string, data: Record<string, unknown>) {
    realtimeBus?.publish({ type, tenantId, data, timestamp: new Date().toISOString() });
  }

  async function logActivity(tenantId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    await db.insert(activityLog).values({
      id: generateId(),
      tenantId,
      action,
      entityType,
      entityId,
      actorType: "user",
      metadata: metadata ?? null,
    }).catch(() => {});
  }

  const app = new Hono<AdminEnv>();

  // Auth middleware — supports API key OR session token
  app.use("/*", async (c, next) => {
    const apiKey = c.req.header("X-API-Key");
    const bearer = c.req.header("Authorization")?.replace("Bearer ", "");

    // Option 1: API key auth
    if (apiKey && apiKey === adminKey) {
      const tenantId = c.req.header("X-Tenant-Id") ?? c.req.query("tenantId") ?? "";
      if (!tenantId) return c.json({ error: "Missing X-Tenant-Id header" }, 400);
      c.set("tenantId", tenantId);
      return next();
    }

    // Option 2: Session token auth (from login)
    if (bearer) {
      const { validateSession } = await import("./auth.js");
      const session = await validateSession(db, bearer);
      if (session) {
        c.set("tenantId", session.tenantId);
        return next();
      }
    }

    return c.json({ error: "Invalid or missing authentication" }, 401);
  });

  // ── Agents ──────────────────────────────────────────────────────────────

  app.get("/agents", async (c) => {
    const rows = await db.select().from(agents).where(eq(agents.tenantId, c.get("tenantId")));
    return c.json({ agents: rows });
  });

  app.get("/agents/:id", async (c) => {
    const rows = await db.select().from(agents).where(
      and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Agent not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/agents", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(agents).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      role: (body.role as string) ?? "general",
      instructions: body.instructions as string | undefined,
      runtimeId: body.runtimeId as string | undefined,
    });
    const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    emit("agent:created", c.get("tenantId"), { agentId: id, name: body.name });
    await logActivity(c.get("tenantId"), "agent.created", "agent", id, { name: body.name, role: body.role });
    return c.json(rows[0], 201);
  });

  app.patch("/agents/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.role !== undefined) values.role = body.role;
    if (body.instructions !== undefined) values.instructions = body.instructions;
    if (body.status !== undefined) values.status = body.status;
    if (body.runtimeId !== undefined) values.runtimeId = body.runtimeId;
    if (body.fallbackRuntimeId !== undefined) values.fallbackRuntimeId = body.fallbackRuntimeId;

    await db.update(agents).set(values).where(
      and(eq(agents.id, c.req.param("id")), eq(agents.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(agents).where(eq(agents.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.post("/agents/:id/wake", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const outcome = await engine.wake({
      agentId: c.req.param("id"),
      tenantId: c.get("tenantId"),
      reason: "manual_request",
      taskId: body.taskId as string | undefined,
    });

    if (outcome.kind === "created") {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return c.json(outcome);
  });

  app.get("/agents/:id/runs", async (c) => {
    const rows = await db.select().from(agentRuns).where(
      and(eq(agentRuns.agentId, c.req.param("id")), eq(agentRuns.tenantId, c.get("tenantId"))),
    ).orderBy(desc(agentRuns.createdAt)).limit(50);
    return c.json({ runs: rows });
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  app.get("/tasks", async (c) => {
    const status = c.req.query("status");
    const assignee = c.req.query("assigneeAgentId");

    let query = db.select().from(tasks).where(eq(tasks.tenantId, c.get("tenantId")));
    // Note: drizzle doesn't chain .where easily, so we filter in-memory for optional params
    const rows = await query.orderBy(desc(tasks.createdAt)).limit(100);

    let filtered = rows;
    if (status) filtered = filtered.filter((t) => t.status === status);
    if (assignee) filtered = filtered.filter((t) => t.assigneeAgentId === assignee);

    return c.json({ tasks: filtered });
  });

  app.get("/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const taskRows = await db.select().from(tasks).where(
      and(eq(tasks.id, taskId), eq(tasks.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!taskRows[0]) return c.json({ error: "Task not found" }, 404);

    const comments = await db.select().from(taskComments)
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));

    const workProducts = await db.select().from(taskWorkProducts)
      .where(eq(taskWorkProducts.taskId, taskId));

    return c.json({ task: taskRows[0], comments, workProducts });
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    const tenantId = c.get("tenantId");
    const projectId = body.projectId as string | undefined;

    // Auto-generate identifier if not provided
    let identifier = body.identifier as string | undefined;
    if (!identifier) {
      if (projectId) {
        // Use project prefix + counter
        const projRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        const proj = projRows[0];
        if (proj) {
          const prefix = proj.prefix ?? proj.name.slice(0, 3).toUpperCase();
          const num = parseInt(proj.nextIssueNumber) || 1;
          identifier = `${prefix}-${String(num).padStart(3, "0")}`;
          await db.update(projects).set({ nextIssueNumber: String(num + 1) }).where(eq(projects.id, projectId));
        }
      } else {
        // Use tenant-level counter from settings
        const { tenantSettings } = await import("@boringos/db");
        const counterRows = await db.select().from(tenantSettings).where(
          and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, "task_counter")),
        ).limit(1);
        const counter = parseInt(counterRows[0]?.value ?? "0") + 1;
        identifier = `BOS-${String(counter).padStart(3, "0")}`;

        if (counterRows[0]) {
          await db.update(tenantSettings).set({ value: String(counter) }).where(eq(tenantSettings.id, counterRows[0].id));
        } else {
          const { tenantSettings: ts } = await import("@boringos/db");
          await db.insert(ts).values({ id: generateId(), tenantId, key: "task_counter", value: String(counter) });
        }
      }
    }

    await db.insert(tasks).values({
      id,
      tenantId,
      title: body.title as string,
      description: body.description as string | undefined,
      status: (body.status as string) ?? "todo",
      priority: (body.priority as string) ?? "medium",
      assigneeAgentId: body.assigneeAgentId as string | undefined,
      parentId: body.parentId as string | undefined,
      identifier,
      originKind: "manual",
    });
    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    emit("task:created", c.get("tenantId"), { taskId: id, title: body.title });
    await logActivity(c.get("tenantId"), "task.created", "task", id, { title: body.title });
    return c.json(rows[0], 201);
  });

  app.patch("/tasks/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.priority !== undefined) values.priority = body.priority;
    if (body.assigneeAgentId !== undefined) values.assigneeAgentId = body.assigneeAgentId;

    await db.update(tasks).set(values).where(
      and(eq(tasks.id, c.req.param("id")), eq(tasks.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(tasks).where(eq(tasks.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/tasks/:id", async (c) => {
    await db.delete(tasks).where(
      and(eq(tasks.id, c.req.param("id")), eq(tasks.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.post("/tasks/:id/comments", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(taskComments).values({
      id,
      taskId: c.req.param("id"),
      tenantId: c.get("tenantId"),
      body: body.body as string,
      authorUserId: body.authorUserId as string | undefined,
    });
    emit("task:comment_added", c.get("tenantId"), { taskId: c.req.param("id"), commentId: id });
    await logActivity(c.get("tenantId"), "comment.created", "task_comment", id, { taskId: c.req.param("id") });
    return c.json({ id }, 201);
  });

  app.post("/tasks/:id/assign", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const agentId = body.agentId as string;
    const taskId = c.req.param("id");

    await db.update(tasks).set({
      assigneeAgentId: agentId,
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId));

    // Optionally wake the agent
    if (body.wake) {
      const outcome = await engine.wake({
        agentId,
        tenantId: c.get("tenantId"),
        reason: "manual_request",
        taskId,
      });
      if (outcome.kind === "created") {
        await engine.enqueue(outcome.wakeupRequestId);
      }
      return c.json({ assigned: true, wakeup: outcome });
    }

    return c.json({ assigned: true });
  });

  // ── Runs ────────────────────────────────────────────────────────────────

  app.get("/runs", async (c) => {
    const agentId = c.req.query("agentId");
    const status = c.req.query("status");

    const rows = await db.select().from(agentRuns)
      .where(eq(agentRuns.tenantId, c.get("tenantId")))
      .orderBy(desc(agentRuns.createdAt))
      .limit(100);

    let filtered = rows;
    if (agentId) filtered = filtered.filter((r) => r.agentId === agentId);
    if (status) filtered = filtered.filter((r) => r.status === status);

    return c.json({ runs: filtered });
  });

  app.get("/runs/:id", async (c) => {
    const rows = await db.select().from(agentRuns).where(
      and(eq(agentRuns.id, c.req.param("id")), eq(agentRuns.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Run not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/runs/:id/cancel", async (c) => {
    await engine.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ── Runtimes ────────────────────────────────────────────────────────────

  app.get("/runtimes", async (c) => {
    const rows = await db.select().from(runtimes).where(eq(runtimes.tenantId, c.get("tenantId")));
    return c.json({ runtimes: rows });
  });

  app.post("/runtimes", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(runtimes).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      type: body.type as string,
      config: (body.config as Record<string, unknown>) ?? {},
      model: body.model as string | undefined,
    });
    const rows = await db.select().from(runtimes).where(eq(runtimes.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/runtimes/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.config !== undefined) values.config = body.config;
    if (body.model !== undefined) values.model = body.model;

    await db.update(runtimes).set(values).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(runtimes).where(eq(runtimes.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/runtimes/:id", async (c) => {
    await db.delete(runtimes).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.post("/runtimes/:id/default", async (c) => {
    const tenantId = c.get("tenantId");
    // Unset all defaults first
    await db.update(runtimes).set({ isDefault: false }).where(eq(runtimes.tenantId, tenantId));
    // Set this one as default
    await db.update(runtimes).set({ isDefault: true, updatedAt: new Date() }).where(
      and(eq(runtimes.id, c.req.param("id")), eq(runtimes.tenantId, tenantId)),
    );
    return c.json({ ok: true });
  });

  // ── Approvals ───────────────────────────────────────────────────────────

  app.get("/approvals", async (c) => {
    const status = c.req.query("status") ?? "pending";
    const rows = await db.select().from(approvals)
      .where(and(eq(approvals.tenantId, c.get("tenantId")), eq(approvals.status, status)))
      .orderBy(desc(approvals.createdAt));
    return c.json({ approvals: rows });
  });

  app.get("/approvals/:id", async (c) => {
    const rows = await db.select().from(approvals).where(
      and(eq(approvals.id, c.req.param("id")), eq(approvals.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Approval not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/approvals/:id/approve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await db.update(approvals).set({
      status: "approved",
      decisionNote: body.note as string | undefined,
      decidedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(approvals.id, c.req.param("id")));

    emit("approval:decided", c.get("tenantId"), { approvalId: c.req.param("id"), status: "approved" });
    await logActivity(c.get("tenantId"), "approval.approved", "approval", c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/approvals/:id/reject", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await db.update(approvals).set({
      status: "rejected",
      decisionNote: body.reason as string | undefined,
      decidedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(approvals.id, c.req.param("id")));

    emit("approval:decided", c.get("tenantId"), { approvalId: c.req.param("id"), status: "rejected" });
    await logActivity(c.get("tenantId"), "approval.rejected", "approval", c.req.param("id"));
    return c.json({ ok: true });
  });

  // ── Activity Log ────────────────────────────────────────────────────────

  app.get("/activity", async (c) => {
    const rows = await db.select().from(activityLog)
      .where(eq(activityLog.tenantId, c.get("tenantId")))
      .orderBy(desc(activityLog.createdAt))
      .limit(100);
    return c.json({ activity: rows });
  });

  // ── Projects ─────────────────────────────────────────────────────────────

  app.get("/projects", async (c) => {
    const rows = await db.select().from(projects).where(eq(projects.tenantId, c.get("tenantId")));
    return c.json({ projects: rows });
  });

  app.get("/projects/:id", async (c) => {
    const rows = await db.select().from(projects).where(
      and(eq(projects.id, c.req.param("id")), eq(projects.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Project not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/projects", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(projects).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      description: body.description as string | undefined,
      prefix: body.prefix as string | undefined,
      repoUrl: body.repoUrl as string | undefined,
      defaultBranch: body.defaultBranch as string | undefined,
      branchTemplate: body.branchTemplate as string | undefined,
    });
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    emit("task:created", c.get("tenantId"), { projectId: id, name: body.name });
    return c.json(rows[0], 201);
  });

  app.patch("/projects/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.repoUrl !== undefined) values.repoUrl = body.repoUrl;

    await db.update(projects).set(values).where(
      and(eq(projects.id, c.req.param("id")), eq(projects.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(projects).where(eq(projects.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  // ── Goals ───────────────────────────────────────────────────────────────

  app.get("/goals", async (c) => {
    const rows = await db.select().from(goals).where(eq(goals.tenantId, c.get("tenantId")));
    return c.json({ goals: rows });
  });

  app.post("/goals", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(goals).values({
      id,
      tenantId: c.get("tenantId"),
      title: body.title as string,
      description: body.description as string | undefined,
    });
    const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/goals/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;

    await db.update(goals).set(values).where(
      and(eq(goals.id, c.req.param("id")), eq(goals.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(goals).where(eq(goals.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  // ── Labels ──────────────────────────────────────────────────────────────

  app.get("/labels", async (c) => {
    const rows = await db.select().from(labels).where(eq(labels.tenantId, c.get("tenantId")));
    return c.json({ labels: rows });
  });

  app.post("/labels", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(labels).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      color: body.color as string | undefined,
    });
    const rows = await db.select().from(labels).where(eq(labels.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.post("/tasks/:taskId/labels/:labelId", async (c) => {
    const id = generateId();
    await db.insert(taskLabels).values({
      id,
      taskId: c.req.param("taskId"),
      labelId: c.req.param("labelId"),
    });
    return c.json({ ok: true }, 201);
  });

  app.delete("/tasks/:taskId/labels/:labelId", async (c) => {
    await db.delete(taskLabels).where(
      and(eq(taskLabels.taskId, c.req.param("taskId")), eq(taskLabels.labelId, c.req.param("labelId"))),
    );
    return c.json({ ok: true });
  });

  // ── Task Read States ────────────────────────────────────────────────────

  app.post("/tasks/:taskId/read", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = body.userId as string ?? "unknown";
    const id = generateId();
    await db.insert(taskReadStates).values({
      id,
      taskId: c.req.param("taskId"),
      userId,
    });
    return c.json({ ok: true });
  });

  // ── Skills ───────────────────────────────────────────────────────────────

  app.get("/skills", async (c) => {
    const rows = await db.select().from(companySkills).where(eq(companySkills.tenantId, c.get("tenantId")));
    return c.json({ skills: rows });
  });

  app.post("/skills", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(companySkills).values({
      id,
      tenantId: c.get("tenantId"),
      key: body.key as string,
      name: body.name as string,
      description: body.description as string | undefined,
      sourceType: body.sourceType as string,
      sourceConfig: (body.sourceConfig as Record<string, unknown>) ?? {},
      trustLevel: (body.trustLevel as string) ?? "markdown_only",
    });
    const rows = await db.select().from(companySkills).where(eq(companySkills.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.post("/skills/:id/attach/:agentId", async (c) => {
    const id = generateId();
    await db.insert(agentSkills).values({
      id,
      skillId: c.req.param("id"),
      agentId: c.req.param("agentId"),
    });
    return c.json({ ok: true }, 201);
  });

  app.delete("/skills/:id/attach/:agentId", async (c) => {
    await db.delete(agentSkills).where(
      and(eq(agentSkills.skillId, c.req.param("id")), eq(agentSkills.agentId, c.req.param("agentId"))),
    );
    return c.json({ ok: true });
  });

  // ── Routines ─────────────────────────────────────────────────────────────

  app.get("/routines", async (c) => {
    const rows = await db.select().from(routines).where(eq(routines.tenantId, c.get("tenantId")));
    return c.json({ routines: rows });
  });

  app.post("/routines", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(routines).values({
      id,
      tenantId: c.get("tenantId"),
      title: body.title as string,
      description: body.description as string | undefined,
      assigneeAgentId: body.assigneeAgentId as string,
      cronExpression: body.cronExpression as string,
      timezone: (body.timezone as string) ?? "UTC",
      concurrencyPolicy: (body.concurrencyPolicy as string) ?? "skip_if_active",
    });
    const rows = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.patch("/routines/:id", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.cronExpression !== undefined) values.cronExpression = body.cronExpression;
    if (body.status !== undefined) values.status = body.status;
    if (body.concurrencyPolicy !== undefined) values.concurrencyPolicy = body.concurrencyPolicy;

    await db.update(routines).set(values).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    );
    const rows = await db.select().from(routines).where(eq(routines.id, c.req.param("id"))).limit(1);
    return c.json(rows[0]);
  });

  app.delete("/routines/:id", async (c) => {
    await db.delete(routines).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.post("/routines/:id/trigger", async (c) => {
    const rows = await db.select().from(routines).where(
      and(eq(routines.id, c.req.param("id")), eq(routines.tenantId, c.get("tenantId"))),
    ).limit(1);
    const routine = rows[0];
    if (!routine) return c.json({ error: "Routine not found" }, 404);

    const outcome = await engine.wake({
      agentId: routine.assigneeAgentId,
      tenantId: c.get("tenantId"),
      reason: "routine_triggered",
    });
    if (outcome.kind === "created") {
      await engine.enqueue(outcome.wakeupRequestId);
    }

    return c.json(outcome);
  });

  // ── Budgets ──────────────────────────────────────────────────────────────

  app.get("/budgets", async (c) => {
    const rows = await db.select().from(budgetPolicies)
      .where(eq(budgetPolicies.tenantId, c.get("tenantId")));
    return c.json({ policies: rows });
  });

  app.post("/budgets", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(budgetPolicies).values({
      id,
      tenantId: c.get("tenantId"),
      agentId: body.agentId as string | undefined,
      scope: (body.scope as string) ?? "tenant",
      period: (body.period as string) ?? "monthly",
      limitCents: body.limitCents as number,
      warnThresholdPct: (body.warnThresholdPct as number) ?? 80,
    });
    const rows = await db.select().from(budgetPolicies).where(eq(budgetPolicies.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.delete("/budgets/:id", async (c) => {
    await db.delete(budgetPolicies).where(
      and(eq(budgetPolicies.id, c.req.param("id")), eq(budgetPolicies.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  app.get("/budgets/incidents", async (c) => {
    const rows = await db.select().from(budgetIncidents)
      .where(eq(budgetIncidents.tenantId, c.get("tenantId")))
      .orderBy(desc(budgetIncidents.createdAt))
      .limit(50);
    return c.json({ incidents: rows });
  });

  // ── Tenants ─────────────────────────────────────────────────────────────

  app.get("/tenants/current", async (c) => {
    const rows = await db.select().from(tenants).where(eq(tenants.id, c.get("tenantId"))).limit(1);
    if (!rows[0]) return c.json({ error: "Tenant not found" }, 404);
    return c.json(rows[0]);
  });

  app.post("/tenants", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(tenants).values({
      id,
      name: body.name as string,
      slug: body.slug as string,
    });
    const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  // ── Drive ───────────────────────────────────────────────────────────────

  app.get("/drive/list", async (c) => {
    const prefix = c.req.query("path");
    const rows = await db.select().from(driveFiles).where(eq(driveFiles.tenantId, c.get("tenantId")));
    let filtered = rows;
    if (prefix) filtered = rows.filter((r) => r.path.startsWith(prefix));
    return c.json({ files: filtered });
  });

  app.get("/drive/skill", async (c) => {
    // Read from most recent revision or return null
    const rows = await db.select().from(driveSkillRevisions)
      .where(eq(driveSkillRevisions.tenantId, c.get("tenantId")))
      .orderBy(desc(driveSkillRevisions.createdAt))
      .limit(1);
    return c.json({ skill: rows[0]?.content ?? null });
  });

  app.patch("/drive/skill", async (c) => {
    const body = await c.req.json() as { content: string; changedBy?: string };
    await db.insert(driveSkillRevisions).values({
      id: generateId(),
      tenantId: c.get("tenantId"),
      content: body.content,
      changedBy: body.changedBy ?? null,
    });
    return c.json({ ok: true });
  });

  app.get("/drive/skill/revisions", async (c) => {
    const rows = await db.select().from(driveSkillRevisions)
      .where(eq(driveSkillRevisions.tenantId, c.get("tenantId")))
      .orderBy(desc(driveSkillRevisions.createdAt))
      .limit(20);
    return c.json({ revisions: rows });
  });

  // ── Onboarding ──────────────────────────────────────────────────────────

  app.get("/onboarding", async (c) => {
    const rows = await db.select().from(onboardingState)
      .where(eq(onboardingState.tenantId, c.get("tenantId")))
      .limit(1);

    if (!rows[0]) {
      // Auto-create onboarding state
      const id = generateId();
      await db.insert(onboardingState).values({ id, tenantId: c.get("tenantId") });
      return c.json({ currentStep: 1, totalSteps: 5, completedSteps: [], completed: false });
    }

    return c.json({
      currentStep: rows[0].currentStep,
      totalSteps: rows[0].totalSteps,
      completedSteps: rows[0].completedSteps,
      completed: !!rows[0].completedAt,
      metadata: rows[0].metadata,
    });
  });

  app.post("/onboarding/complete-step", async (c) => {
    const body = await c.req.json() as { step: number; metadata?: Record<string, unknown> };
    const tenantId = c.get("tenantId");

    const rows = await db.select().from(onboardingState)
      .where(eq(onboardingState.tenantId, tenantId)).limit(1);

    if (!rows[0]) {
      return c.json({ error: "Onboarding not started" }, 404);
    }

    const completed = [...(rows[0].completedSteps as number[])];
    if (!completed.includes(body.step)) completed.push(body.step);

    const nextStep = body.step + 1;
    const isComplete = completed.length >= rows[0].totalSteps;

    const updates: Record<string, unknown> = {
      currentStep: isComplete ? rows[0].totalSteps : nextStep,
      completedSteps: completed,
      updatedAt: new Date(),
    };
    if (body.metadata) {
      const existing = rows[0].metadata as Record<string, unknown>;
      updates.metadata = { ...existing, [`step${body.step}`]: body.metadata };
    }
    if (isComplete) updates.completedAt = new Date();

    await db.update(onboardingState).set(updates).where(eq(onboardingState.id, rows[0].id));

    return c.json({ step: body.step, completed: isComplete, nextStep: isComplete ? null : nextStep });
  });

  // ── Evals ───────────────────────────────────────────────────────────────

  app.get("/evals", async (c) => {
    const rows = await db.select().from(evals).where(eq(evals.tenantId, c.get("tenantId")));
    return c.json({ evals: rows });
  });

  app.post("/evals", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const id = generateId();
    await db.insert(evals).values({
      id,
      tenantId: c.get("tenantId"),
      name: body.name as string,
      description: body.description as string | undefined,
      testCases: (body.testCases as Array<{ input: string }>) ?? [],
    });
    const rows = await db.select().from(evals).where(eq(evals.id, id)).limit(1);
    return c.json(rows[0], 201);
  });

  app.get("/evals/:id/runs", async (c) => {
    const rows = await db.select().from(evalRuns)
      .where(and(eq(evalRuns.evalId, c.req.param("id")), eq(evalRuns.tenantId, c.get("tenantId"))))
      .orderBy(desc(evalRuns.startedAt));
    return c.json({ runs: rows });
  });

  app.post("/evals/:id/run", async (c) => {
    const body = await c.req.json() as { agentId: string };
    const evalRows = await db.select().from(evals).where(eq(evals.id, c.req.param("id"))).limit(1);
    if (!evalRows[0]) return c.json({ error: "Eval not found" }, 404);

    const id = generateId();
    const testCases = evalRows[0].testCases as Array<{ input: string }>;
    await db.insert(evalRuns).values({
      id,
      tenantId: c.get("tenantId"),
      evalId: c.req.param("id"),
      agentId: body.agentId,
      totalCases: testCases.length,
      status: "pending",
    });

    return c.json({ runId: id, totalCases: testCases.length }, 201);
  });

  // ── Inbox ───────────────────────────────────────────────────────────────

  app.get("/inbox", async (c) => {
    const status = c.req.query("status") ?? "unread";
    const rows = await db.select().from(inboxItems)
      .where(and(eq(inboxItems.tenantId, c.get("tenantId")), eq(inboxItems.status, status)))
      .orderBy(desc(inboxItems.createdAt))
      .limit(100);
    return c.json({ items: rows });
  });

  app.get("/inbox/:id", async (c) => {
    const rows = await db.select().from(inboxItems).where(
      and(eq(inboxItems.id, c.req.param("id")), eq(inboxItems.tenantId, c.get("tenantId"))),
    ).limit(1);
    if (!rows[0]) return c.json({ error: "Inbox item not found" }, 404);

    // Mark as read
    if (rows[0].status === "unread") {
      await db.update(inboxItems).set({ status: "read", updatedAt: new Date() }).where(eq(inboxItems.id, rows[0].id));
    }

    return c.json(rows[0]);
  });

  app.post("/inbox/:id/archive", async (c) => {
    await db.update(inboxItems).set({
      status: "archived",
      archivedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(inboxItems.id, c.req.param("id")), eq(inboxItems.tenantId, c.get("tenantId"))));
    return c.json({ ok: true });
  });

  app.post("/inbox/:id/create-task", async (c) => {
    const itemRows = await db.select().from(inboxItems).where(eq(inboxItems.id, c.req.param("id"))).limit(1);
    if (!itemRows[0]) return c.json({ error: "Inbox item not found" }, 404);

    const item = itemRows[0];
    const taskId = generateId();
    await db.insert(tasks).values({
      id: taskId,
      tenantId: c.get("tenantId"),
      title: item.subject,
      description: item.body ?? undefined,
      status: "todo",
      priority: "medium",
      originKind: "inbox",
      originId: item.id,
    });

    await db.update(inboxItems).set({ linkedTaskId: taskId, updatedAt: new Date() }).where(eq(inboxItems.id, item.id));

    return c.json({ taskId }, 201);
  });

  // ── Costs ───────────────────────────────────────────────────────────────

  app.get("/costs", async (c) => {
    const rows = await db.select().from(costEvents)
      .where(eq(costEvents.tenantId, c.get("tenantId")))
      .orderBy(desc(costEvents.createdAt))
      .limit(100);
    return c.json({ costs: rows });
  });

  // ── Entity References ────────────────────────────────────────────────────

  app.post("/entities/link", async (c) => {
    const body = await c.req.json() as { entityType: string; entityId: string; refType: string; refId: string };
    const id = generateId();
    await db.insert(entityReferences).values({
      id,
      tenantId: c.get("tenantId"),
      entityType: body.entityType,
      entityId: body.entityId,
      refType: body.refType,
      refId: body.refId,
    });
    return c.json({ id }, 201);
  });

  app.get("/entities/:type/:id/refs", async (c) => {
    const rows = await db.select().from(entityReferences).where(
      and(
        eq(entityReferences.tenantId, c.get("tenantId")),
        eq(entityReferences.entityType, c.req.param("type")),
        eq(entityReferences.entityId, c.req.param("id")),
      ),
    );

    // Group by refType
    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      if (!grouped[row.refType]) grouped[row.refType] = [];
      grouped[row.refType].push(row.refId);
    }

    return c.json({ entityType: c.req.param("type"), entityId: c.req.param("id"), refs: grouped });
  });

  app.delete("/entities/link/:id", async (c) => {
    await db.delete(entityReferences).where(
      and(eq(entityReferences.id, c.req.param("id")), eq(entityReferences.tenantId, c.get("tenantId"))),
    );
    return c.json({ ok: true });
  });

  // ── Search ──────────────────────────────────────────────────────────────

  app.get("/search", async (c) => {
    const q = c.req.query("q");
    if (!q) return c.json({ error: "Missing q parameter" }, 400);

    const tenantId = c.get("tenantId");
    const pattern = `%${q}%`;

    // Search across multiple tables in parallel
    const [taskResults, agentResults, inboxResults] = await Promise.all([
      db.execute(
        sql`SELECT id, title, status, identifier FROM tasks WHERE tenant_id = ${tenantId} AND (title ILIKE ${pattern} OR description ILIKE ${pattern}) LIMIT 20`,
      ),
      db.execute(
        sql`SELECT id, name, role, status FROM agents WHERE tenant_id = ${tenantId} AND (name ILIKE ${pattern} OR role ILIKE ${pattern}) LIMIT 20`,
      ),
      db.execute(
        sql`SELECT id, subject, source, status FROM inbox_items WHERE tenant_id = ${tenantId} AND (subject ILIKE ${pattern} OR body ILIKE ${pattern}) LIMIT 20`,
      ),
    ]);

    return c.json({
      tasks: taskResults,
      agents: agentResults,
      inboxItems: inboxResults,
    });
  });

  return app;
}

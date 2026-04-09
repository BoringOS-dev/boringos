/**
 * Phase 18 — Workflow-triggered routines + new block handlers
 *
 * Tests:
 * 1. wake-agent handler calls agentEngine.wake() correctly
 * 2. wake-agent handler handles missing agentId gracefully
 * 3. connector-action handler calls actionRunner.execute() correctly
 * 4. connector-action handler handles missing connector gracefully
 * 5. Workflow with wake-agent block executes end-to-end
 * 6. Routine with workflowId triggers workflow (integration)
 */

import { describe, it, expect } from "vitest";

// ── wake-agent handler unit tests ────────────────────────────────────────────

describe("wake-agent handler", () => {
  it("calls agentEngine.wake() with correct params", async () => {
    const { wakeAgentHandler, createExecutionState } = await import("@boringos/workflow");

    let wakeCalled = false;
    let wakeArgs: Record<string, unknown> = {};
    let enqueueCalled = false;

    const mockEngine = {
      async wake(req: Record<string, unknown>) {
        wakeCalled = true;
        wakeArgs = req;
        return { kind: "created", wakeupRequestId: "wk-123" };
      },
      async enqueue(id: string) {
        enqueueCalled = true;
        return id;
      },
    };

    const result = await wakeAgentHandler.execute({
      blockId: "b1", blockName: "wake", blockType: "wake-agent",
      config: { agentId: "agent-abc", reason: "email_sync", taskId: "task-xyz" },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: {
        get: (key: string) => key === "agentEngine" ? mockEngine : undefined,
        has: (key: string) => key === "agentEngine",
      },
    });

    expect(wakeCalled).toBe(true);
    expect(wakeArgs.agentId).toBe("agent-abc");
    expect(wakeArgs.tenantId).toBe("t1");
    expect(wakeArgs.reason).toBe("email_sync");
    expect(wakeArgs.taskId).toBe("task-xyz");
    expect(enqueueCalled).toBe(true);
    expect(result.output.outcome).toBe("created");
    expect(result.output.wakeupRequestId).toBe("wk-123");
  });

  it("returns error when agentId is missing", async () => {
    const { wakeAgentHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await wakeAgentHandler.execute({
      blockId: "b1", blockName: "wake", blockType: "wake-agent",
      config: {},
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.outcome).toBe("error");
    expect(result.output.error).toContain("agentId");
  });

  it("returns error when agentEngine is not in services", async () => {
    const { wakeAgentHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await wakeAgentHandler.execute({
      blockId: "b1", blockName: "wake", blockType: "wake-agent",
      config: { agentId: "agent-abc" },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.outcome).toBe("error");
    expect(result.output.error).toContain("agentEngine");
  });
});

// ── connector-action handler unit tests ──────────────────────────────────────

describe("connector-action handler", () => {
  it("returns error when connectorKind is missing", async () => {
    const { connectorActionHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await connectorActionHandler.execute({
      blockId: "b1", blockName: "fetch", blockType: "connector-action",
      config: {},
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("connectorKind");
  });

  it("returns error when actionRunner is not available", async () => {
    const { connectorActionHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await connectorActionHandler.execute({
      blockId: "b1", blockName: "fetch", blockType: "connector-action",
      config: { connectorKind: "google", action: "list_emails" },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain("actionRunner");
  });
});

// ── End-to-end: workflow with wake-agent block ───────────────────────────────

describe("workflow with wake-agent block", () => {
  it("executes trigger → condition → wake-agent flow", async () => {
    const {
      createWorkflowEngine,
      createWorkflowStore,
      createHandlerRegistry,
      createExecutionState,
      triggerHandler,
      conditionHandler,
      wakeAgentHandler,
    } = await import("@boringos/workflow");

    let agentWoken = false;
    let wokenAgentId = "";

    const mockEngine = {
      async wake(req: Record<string, unknown>) {
        agentWoken = true;
        wokenAgentId = req.agentId as string;
        return { kind: "created", wakeupRequestId: "wk-e2e" };
      },
      async enqueue() { return "run-id"; },
    };

    const registry = createHandlerRegistry();
    registry.register(triggerHandler);
    registry.register(conditionHandler);
    registry.register(wakeAgentHandler);

    // In-memory store with a single workflow
    const workflow = {
      id: "wf-1",
      tenantId: "t1",
      name: "Email sync",
      type: "system" as const,
      governingAgentId: null,
      status: "active" as const,
      blocks: [
        { id: "trigger", name: "trigger", type: "trigger", config: {} },
        { id: "check", name: "check", type: "condition", config: { field: "3", operator: "truthy" } },
        { id: "wake", name: "wake", type: "wake-agent", config: { agentId: "agent-email" } },
      ],
      edges: [
        { id: "e1", sourceBlockId: "trigger", targetBlockId: "check", sourceHandle: null, sortOrder: 0 },
        { id: "e2", sourceBlockId: "check", targetBlockId: "wake", sourceHandle: "condition-true", sortOrder: 0 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = createWorkflowEngine({
      store: {
        async get(id: string) { return id === "wf-1" ? workflow : null; },
        async list() { return [workflow]; },
        async create() { return workflow; },
        async update() { return workflow; },
        async delete() {},
      },
      handlers: registry,
      services: {
        get: (key: string) => key === "agentEngine" ? mockEngine : undefined,
        has: (key: string) => key === "agentEngine",
      },
    });

    const result = await engine.execute("wf-1", { type: "routine", data: { emailCount: 3 } });

    expect(result.status).toBe("completed");
    expect(agentWoken).toBe(true);
    expect(wokenAgentId).toBe("agent-email");
  });

  it("skips wake-agent when condition is false", async () => {
    const {
      createWorkflowEngine,
      createHandlerRegistry,
      triggerHandler,
      conditionHandler,
      wakeAgentHandler,
    } = await import("@boringos/workflow");

    let agentWoken = false;

    const mockEngine = {
      async wake() { agentWoken = true; return { kind: "created", wakeupRequestId: "x" }; },
      async enqueue() { return "r"; },
    };

    const registry = createHandlerRegistry();
    registry.register(triggerHandler);
    registry.register(conditionHandler);
    registry.register(wakeAgentHandler);

    const workflow = {
      id: "wf-2",
      tenantId: "t1",
      name: "No emails",
      type: "system" as const,
      governingAgentId: null,
      status: "active" as const,
      blocks: [
        { id: "trigger", name: "trigger", type: "trigger", config: {} },
        { id: "check", name: "check", type: "condition", config: { field: "", operator: "truthy" } },
        { id: "wake", name: "wake", type: "wake-agent", config: { agentId: "agent-email" } },
      ],
      edges: [
        { id: "e1", sourceBlockId: "trigger", targetBlockId: "check", sourceHandle: null, sortOrder: 0 },
        { id: "e2", sourceBlockId: "check", targetBlockId: "wake", sourceHandle: "condition-true", sortOrder: 0 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = createWorkflowEngine({
      store: {
        async get(id: string) { return id === "wf-2" ? workflow : null; },
        async list() { return [workflow]; },
        async create() { return workflow; },
        async update() { return workflow; },
        async delete() {},
      },
      handlers: registry,
      services: {
        get: (key: string) => key === "agentEngine" ? mockEngine : undefined,
        has: (key: string) => key === "agentEngine",
      },
    });

    const result = await engine.execute("wf-2", { type: "routine", data: {} });

    expect(result.status).toBe("completed");
    expect(agentWoken).toBe(false);
  });
});

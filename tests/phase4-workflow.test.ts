/**
 * Phase 4 Smoke Tests — Workflow Engine
 *
 * Tests DAG building, execution state, handler registry, engine execution,
 * and end-to-end workflow with branching.
 */
import { describe, it, expect } from "vitest";

// ── DAG builder ─────────────────────────────────────────────────────────────

describe("workflow: DAG builder", () => {
  it("builds a DAG from blocks and edges", async () => {
    const { buildDAG } = await import("@boringos/workflow");

    const dag = buildDAG(
      [
        { id: "b1", name: "start", type: "trigger", config: {} },
        { id: "b2", name: "step1", type: "transform", config: {} },
        { id: "b3", name: "step2", type: "transform", config: {} },
      ],
      [
        { id: "e1", sourceBlockId: "b1", targetBlockId: "b2", sourceHandle: null, sortOrder: 0 },
        { id: "e2", sourceBlockId: "b2", targetBlockId: "b3", sourceHandle: null, sortOrder: 1 },
      ],
    );

    expect(dag.startNodeId).toBe("b1");
    expect(dag.nodes.size).toBe(3);
    expect(dag.nodes.get("b2")!.incomingBlockIds.has("b1")).toBe(true);
    expect(dag.nodes.get("b1")!.outgoingEdges).toHaveLength(1);
  });

  it("identifies trigger as start node", async () => {
    const { buildDAG } = await import("@boringos/workflow");

    const dag = buildDAG(
      [
        { id: "a", name: "not-trigger", type: "transform", config: {} },
        { id: "b", name: "the-trigger", type: "trigger", config: {} },
      ],
      [],
    );

    expect(dag.startNodeId).toBe("b");
  });
});

// ── Execution state ─────────────────────────────────────────────────────────

describe("workflow: ExecutionState", () => {
  it("stores and retrieves block state", async () => {
    const { createExecutionState } = await import("@boringos/workflow");

    const state = createExecutionState();
    state.set("b1", { status: "completed", output: { value: 42 } });

    expect(state.get("b1")?.status).toBe("completed");
    expect(state.get("b1")?.output?.value).toBe(42);
    expect(state.get("unknown")).toBeUndefined();
  });

  it("resolveTemplate substitutes block outputs", async () => {
    const { createExecutionState, resolveTemplate } = await import("@boringos/workflow");

    const state = createExecutionState();
    state.set("b1", { status: "completed", output: { message: "hello world" } });

    const nameToId = new Map([["step1", "b1"]]);
    const result = resolveTemplate("Result: {{step1.message}}", state, nameToId);
    expect(result).toBe("Result: hello world");
  });

  it("resolveTemplate preserves unresolved references", async () => {
    const { createExecutionState, resolveTemplate } = await import("@boringos/workflow");

    const state = createExecutionState();
    const nameToId = new Map<string, string>();
    const result = resolveTemplate("{{missing.field}}", state, nameToId);
    expect(result).toBe("{{missing.field}}");
  });
});

// ── Handler registry ────────────────────────────────────────────────────────

describe("workflow: handler registry", () => {
  it("registers and retrieves handlers by type", async () => {
    const { createHandlerRegistry, triggerHandler, conditionHandler } = await import("@boringos/workflow");

    const registry = createHandlerRegistry();
    registry.register(triggerHandler);
    registry.register(conditionHandler);

    expect(registry.has("trigger")).toBe(true);
    expect(registry.has("condition")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
    expect(registry.get("trigger")).toBe(triggerHandler);
  });
});

// ── Built-in handlers ───────────────────────────────────────────────────────

describe("workflow: built-in handlers", () => {
  it("trigger handler passes config as output", async () => {
    const { triggerHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await triggerHandler.execute({
      blockId: "b1", blockName: "start", blockType: "trigger",
      config: { email: "test@example.com" },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.email).toBe("test@example.com");
  });

  it("condition handler returns true/false handle", async () => {
    const { conditionHandler, createExecutionState } = await import("@boringos/workflow");

    const ctx = {
      blockId: "b1", blockName: "check", blockType: "condition",
      config: { field: "support", operator: "equals", value: "support" },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    };

    const result = await conditionHandler.execute(ctx);
    expect(result.selectedHandle).toBe("condition-true");

    const result2 = await conditionHandler.execute({
      ...ctx,
      config: { field: "support", operator: "equals", value: "sales" },
    });
    expect(result2.selectedHandle).toBe("condition-false");
  });

  it("delay handler waits and returns", async () => {
    const { delayHandler, createExecutionState } = await import("@boringos/workflow");

    const start = Date.now();
    const result = await delayHandler.execute({
      blockId: "b1", blockName: "wait", blockType: "delay",
      config: { durationMs: 50 },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.delayed).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("transform handler maps data", async () => {
    const { transformHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await transformHandler.execute({
      blockId: "b1", blockName: "map", blockType: "transform",
      config: { mappings: { greeting: "Hello", count: 3 } },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.greeting).toBe("Hello");
    expect(result.output.count).toBe(3);
  });
});

// ── Workflow engine: in-memory execution ─────────────────────────────────────

describe("workflow: engine execution", () => {
  it("executes a linear 3-block workflow", async () => {
    const {
      createWorkflowEngine,
      createHandlerRegistry,
      triggerHandler,
      transformHandler,
    } = await import("@boringos/workflow");

    const registry = createHandlerRegistry();
    registry.register(triggerHandler);
    registry.register(transformHandler);

    // In-memory store for this test
    const workflow = {
      id: "w1",
      tenantId: "t1",
      name: "test-workflow",
      type: "user" as const,
      status: "active" as const,
      governingAgentId: null,
      blocks: [
        { id: "b1", name: "start", type: "trigger", config: {} },
        { id: "b2", name: "greet", type: "transform", config: { mappings: { message: "hello" } } },
        { id: "b3", name: "done", type: "transform", config: { mappings: { final: "complete" } } },
      ],
      edges: [
        { id: "e1", sourceBlockId: "b1", targetBlockId: "b2", sourceHandle: null, sortOrder: 0 },
        { id: "e2", sourceBlockId: "b2", targetBlockId: "b3", sourceHandle: null, sortOrder: 1 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = createWorkflowEngine({
      store: {
        async get() { return workflow; },
        async list() { return [workflow]; },
        async create() { return workflow; },
        async update() { return workflow; },
        async delete() {},
      },
      handlers: registry,
      services: { get: () => undefined, has: () => false },
    });

    const result = await engine.execute("w1", { type: "manual", data: { source: "test" } });

    expect(result.status).toBe("completed");
    expect(result.blockResults.get("b2")?.output.message).toBe("hello");
    expect(result.blockResults.get("b3")?.output.final).toBe("complete");
  });

  it("executes a branching workflow with condition", async () => {
    const {
      createWorkflowEngine,
      createHandlerRegistry,
      triggerHandler,
      conditionHandler,
      transformHandler,
    } = await import("@boringos/workflow");

    const registry = createHandlerRegistry();
    registry.register(triggerHandler);
    registry.register(conditionHandler);
    registry.register(transformHandler);

    const workflow = {
      id: "w2",
      tenantId: "t1",
      name: "branching",
      type: "user" as const,
      status: "active" as const,
      governingAgentId: null,
      blocks: [
        { id: "b1", name: "start", type: "trigger", config: {} },
        { id: "b2", name: "check", type: "condition", config: { field: "yes", operator: "truthy" } },
        { id: "b3", name: "true-path", type: "transform", config: { mappings: { path: "true" } } },
        { id: "b4", name: "false-path", type: "transform", config: { mappings: { path: "false" } } },
      ],
      edges: [
        { id: "e1", sourceBlockId: "b1", targetBlockId: "b2", sourceHandle: null, sortOrder: 0 },
        { id: "e2", sourceBlockId: "b2", targetBlockId: "b3", sourceHandle: "condition-true", sortOrder: 1 },
        { id: "e3", sourceBlockId: "b2", targetBlockId: "b4", sourceHandle: "condition-false", sortOrder: 2 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const engine = createWorkflowEngine({
      store: {
        async get() { return workflow; },
        async list() { return [workflow]; },
        async create() { return workflow; },
        async update() { return workflow; },
        async delete() {},
      },
      handlers: registry,
      services: { get: () => undefined, has: () => false },
    });

    const result = await engine.execute("w2");

    expect(result.status).toBe("completed");
    // Condition is truthy, so true-path executes and false-path does not
    expect(result.blockResults.has("b3")).toBe(true);
    expect(result.blockResults.get("b3")?.output.path).toBe("true");
    expect(result.blockResults.has("b4")).toBe(false);
  });
});

// ── Workflow engine with DB store ───────────────────────────────────────────

describe("workflow: DB-backed store", () => {
  it("creates, stores, and executes a workflow via Drizzle", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { createWorkflowStore } = await import("@boringos/workflow");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-wf-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5595 },
      drive: { root: join(dataDir, "drive") },
    });

    const server = await app.listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const { tenants } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");

      // Create tenant
      const tenantId = generateId();
      await db.insert(tenants).values({ id: tenantId, name: "WF Test", slug: "wf-test" });

      // Create workflow via store
      const store = createWorkflowStore(db);
      const wf = await store.create({
        tenantId,
        name: "test-wf",
        blocks: [
          { id: "b1", name: "start", type: "trigger", config: {} },
          { id: "b2", name: "step", type: "transform", config: { mappings: { done: true } } },
        ],
        edges: [
          { id: "e1", sourceBlockId: "b1", targetBlockId: "b2", sourceHandle: null, sortOrder: 0 },
        ],
      });

      expect(wf.id).toBeTruthy();
      expect(wf.name).toBe("test-wf");

      // Retrieve it
      const fetched = await store.get(wf.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.blocks).toHaveLength(2);

      // Execute via engine
      const engine = server.context.workflowEngine!;
      const result = await engine.execute(wf.id);
      expect(result.status).toBe("completed");
      expect(result.blockResults.get("b2")?.output.done).toBe(true);
    } finally {
      await server.close();
    }
  }, 30000);
});

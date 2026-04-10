/**
 * Phase 20 Smoke Tests — Sync workflow block handlers
 * for-each, create-inbox-item, emit-event
 */
import { describe, it, expect } from "vitest";

describe("for-each handler", () => {
  it("processes array and returns count", async () => {
    const { forEachHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await forEachHandler.execute({
      blockId: "b1", blockName: "loop", blockType: "for-each",
      config: { items: [{ id: "1", subject: "Email 1" }, { id: "2", subject: "Email 2" }] },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.count).toBe(2);
    expect(result.output.processed).toBe(true);
    expect((result.output.items as unknown[]).length).toBe(2);
  });

  it("handles JSON string items", async () => {
    const { forEachHandler, createExecutionState } = await import("@boringos/workflow");

    const result = await forEachHandler.execute({
      blockId: "b1", blockName: "loop", blockType: "for-each",
      config: { items: JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]) },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "user",
      state: createExecutionState(),
      services: { get: () => undefined, has: () => false },
    });

    expect(result.output.count).toBe(3);
  });
});

describe("create-inbox-item handler", () => {
  it("creates inbox items from array", async () => {
    const { createInboxItemHandler, createExecutionState } = await import("@boringos/workflow");
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const d = await mkdtemp(join(tmpdir(), "boringos-sync-"));
    const server = await new BoringOS({
      database: { embedded: true, dataDir: d, port: 5560 },
      drive: { root: join(d, "drive") },
      auth: { secret: "s", adminKey: "k" },
    }).listen(0);

    try {
      const db = server.context.db as import("@boringos/db").Db;
      const { tenants, inboxItems } = await import("@boringos/db");
      const { generateId } = await import("@boringos/shared");
      const { eq } = await import("drizzle-orm");

      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Sync Co", slug: "sync-co" });

      const result = await createInboxItemHandler.execute({
        blockId: "b1", blockName: "store", blockType: "create-inbox-item",
        config: {
          source: "gmail",
          items: [
            { subject: "Meeting tomorrow", from: "boss@acme.com", snippet: "Let's discuss Q3." },
            { subject: "Invoice #42", from: "billing@vendor.com", snippet: "Payment due." },
          ],
        },
        workflowRunId: "r1", workflowId: "w1", tenantId: tid,
        governingAgentId: null, workflowType: "system",
        state: createExecutionState(),
        services: { get: (k: string) => k === "db" ? db : undefined, has: (k: string) => k === "db" },
      });

      expect(result.output.created).toBe(2);

      // Verify in DB
      const rows = await db.select().from(inboxItems).where(eq(inboxItems.tenantId, tid));
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.subject).sort()).toEqual(["Invoice #42", "Meeting tomorrow"]);
    } finally { await server.close(); }
  }, 30000);
});

describe("emit-event handler", () => {
  it("emits events to event bus", async () => {
    const { emitEventHandler, createExecutionState } = await import("@boringos/workflow");
    const { createEventBus } = await import("@boringos/connector");

    const bus = createEventBus();
    const received: string[] = [];
    bus.onAny((event) => received.push((event as any).type));

    await emitEventHandler.execute({
      blockId: "b1", blockName: "notify", blockType: "emit-event",
      config: {
        connectorKind: "google",
        eventType: "email_received",
        items: [{ subject: "Test 1" }, { subject: "Test 2" }],
      },
      workflowRunId: "r1", workflowId: "w1", tenantId: "t1",
      governingAgentId: null, workflowType: "system",
      state: createExecutionState(),
      services: { get: (k: string) => k === "eventBus" ? bus : undefined, has: (k: string) => k === "eventBus" },
    });

    expect(received).toEqual(["email_received", "email_received"]);
  });
});

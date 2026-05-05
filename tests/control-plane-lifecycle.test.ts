/**
 * K6 — onTenantCreated invoker + ActionContext factory.
 *
 * Verifies (a) lifecycle ctx shape, (b) action ctx shape + emit
 * delegation, (c) failures inside onTenantCreated propagate and
 * roll back the prior K3-K4 inserts via the surrounding install
 * transaction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import {
  createDrizzleInstallDb,
  createLifecycleContext,
  invokeOnTenantCreated,
  createActionContext,
  registerAppAgents,
  registerAppWorkflows,
} from "@boringos/control-plane";
import { defineApp } from "@boringos/app-sdk";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k6-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5594,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K6 Test', 'k6-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("createLifecycleContext", () => {
  it("returns a LifecycleContext satisfying the SDK shape", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const captured: any[] = [];
    await adapter.transaction(async (_db, tx) => {
      const ctx = createLifecycleContext({ tx, tenantId });
      expect(ctx.tenantId).toBe(tenantId);
      expect(ctx.db).toBeTruthy();
      expect(typeof ctx.log.info).toBe("function");
      ctx.log.info("hello", { x: 1 });
      captured.push(ctx);
    });
    expect(captured).toHaveLength(1);
  });
});

describe("invokeOnTenantCreated", () => {
  it("calls the hook and lets it run inside the transaction", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const seen: { tenantId: string }[] = [];

    const app = defineApp({
      id: "k6-app-success",
      onTenantCreated: async (ctx) => {
        seen.push({ tenantId: ctx.tenantId });
      },
    });

    await adapter.transaction(async (_db, tx) => {
      const ctx = createLifecycleContext({ tx, tenantId });
      await invokeOnTenantCreated(app, ctx);
    });

    expect(seen).toEqual([{ tenantId }]);
  });

  it("apps without an onTenantCreated hook are a no-op", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    await adapter.transaction(async (_db, tx) => {
      const ctx = createLifecycleContext({ tx, tenantId });
      await invokeOnTenantCreated(defineApp({ id: "k6-app-bare" }), ctx);
    });
  });

  it("a throwing hook rolls back agents/workflows registered earlier in the same txn", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const appId = "k6-rollback";

    const throwingApp = defineApp({
      id: appId,
      agents: [{ id: "a", name: "Agent A" }],
      workflows: [{ id: "wf", name: "WF", blocks: [], edges: [] }],
      onTenantCreated: async () => {
        throw new Error("seed failed");
      },
    });

    await expect(
      adapter.transaction(async (_db, tx) => {
        await registerAppAgents(tx, {
          tenantId,
          appId,
          agents: throwingApp.agents ?? [],
        });
        await registerAppWorkflows(tx, {
          tenantId,
          appId,
          templates: throwingApp.workflows ?? [],
        });
        const ctx = createLifecycleContext({ tx, tenantId });
        await invokeOnTenantCreated(throwingApp, ctx);
      }),
    ).rejects.toThrow("seed failed");

    const agentRows = (await conn.db.execute(sql`
      SELECT id FROM agents
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId })}::jsonb
    `)) as Array<{ id: string }>;
    const wfRows = (await conn.db.execute(sql`
      SELECT id FROM workflows
      WHERE tenant_id = ${tenantId}
        AND metadata @> ${JSON.stringify({ appId })}::jsonb
    `)) as Array<{ id: string }>;
    expect(agentRows).toEqual([]);
    expect(wfRows).toEqual([]);
  });
});

describe("createActionContext", () => {
  it("returns an ActionContext with caller identity + working emit()", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = createActionContext({
      db: conn.db,
      tenantId,
      userId: "user-1",
      role: "admin",
      events: {
        emit: (type, payload) => {
          events.push({ type, payload });
        },
      },
    });

    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.userId).toBe("user-1");
    expect(ctx.role).toBe("admin");
    expect(typeof ctx.log.warn).toBe("function");

    await ctx.emit("crm.deal.updated", { dealId: "d-1" });
    expect(events).toEqual([
      { type: "crm.deal.updated", payload: { dealId: "d-1" } },
    ]);
  });
});

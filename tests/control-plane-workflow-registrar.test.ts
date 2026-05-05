/**
 * K4 — workflow template registration runner.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import {
  createDrizzleInstallDb,
  registerAppWorkflows,
  registerWorkflowsFromDefinition,
} from "@boringos/control-plane";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

const triageOnInbox = {
  id: "generic-triage.triage-on-inbox",
  name: "Triage incoming inbox items",
  description: "Wake the triage agent on inbox.item_created.",
  blocks: [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      config: { eventType: "inbox.item_created" },
    },
    {
      id: "wake-triage",
      name: "wake-triage",
      type: "wake-agent",
      config: { agentId: "generic-triage.triage" },
    },
  ],
  edges: [
    {
      id: "e1",
      sourceBlockId: "trigger",
      targetBlockId: "wake-triage",
      sourceHandle: null,
      sortOrder: 0,
    },
  ],
  triggers: [{ type: "event", event: "inbox.item_created" }],
};

const calendarCheck = {
  id: "crm.calendar-check",
  name: "Calendar check",
  description: "Run every 15 minutes",
  blocks: [
    { id: "trigger", name: "trigger", type: "trigger", config: {} },
  ],
  edges: [],
  triggers: [{ type: "cron", cron: "*/15 * * * *", timezone: "UTC" }],
};

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k4-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5595,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K4 Test', 'k4-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function listWorkflowsForApp(appId: string) {
  return (await conn.db.execute(sql`
    SELECT id, name, type, status, blocks, edges, metadata
    FROM workflows
    WHERE tenant_id = ${tenantId}
      AND metadata @> ${JSON.stringify({ appId })}::jsonb
    ORDER BY name
  `)) as Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    blocks: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  }>;
}

async function listRoutinesByWorkflow(workflowId: string) {
  return (await conn.db.execute(sql`
    SELECT id, cron_expression, timezone, status, workflow_id
    FROM routines
    WHERE workflow_id = ${workflowId}
  `)) as Array<{
    id: string;
    cron_expression: string;
    timezone: string;
    status: string;
    workflow_id: string;
  }>;
}

describe("registerAppWorkflows", () => {
  it("creates a workflow row per template, with blocks/edges and metadata.appId", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const result = await adapter.transaction(async (_db, tx) =>
      registerAppWorkflows(tx, {
        tenantId,
        appId: "generic-triage",
        templates: [triageOnInbox],
      }),
    );

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]?.appWorkflowDefId).toBe(
      "generic-triage.triage-on-inbox",
    );

    const rows = await listWorkflowsForApp("generic-triage");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({
      appId: "generic-triage",
      appWorkflowDefId: "generic-triage.triage-on-inbox",
    });
    expect(rows[0]?.type).toBe("system");
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.blocks).toHaveLength(2);
    // The inbox.item_created trigger lives inside the workflow's blocks —
    // dispatcher reads it from there.
    const triggerBlock = rows[0]?.blocks.find(
      (b) => (b as { type: string }).type === "trigger",
    ) as { config: { eventType: string } } | undefined;
    expect(triggerBlock?.config.eventType).toBe("inbox.item_created");
  });

  it("cron triggers create a routine row pointing at the workflow", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    const result = await adapter.transaction(async (_db, tx) =>
      registerAppWorkflows(tx, {
        tenantId,
        appId: "k4-cron-app",
        templates: [calendarCheck],
      }),
    );

    expect(result.inserted).toHaveLength(1);
    const wf = result.inserted[0]!;
    expect(wf.routineIds).toHaveLength(1);

    const routines = await listRoutinesByWorkflow(wf.id);
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({
      cron_expression: "*/15 * * * *",
      timezone: "UTC",
      status: "active",
    });
  });

  it("re-install replaces (delete + insert by app id) — workflows and routines", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    await adapter.transaction(async (_db, tx) =>
      registerAppWorkflows(tx, {
        tenantId,
        appId: "k4-reinstall",
        templates: [calendarCheck, triageOnInbox],
      }),
    );

    const beforeWorkflows = await listWorkflowsForApp("k4-reinstall");
    expect(beforeWorkflows).toHaveLength(2);

    const result = await adapter.transaction(async (_db, tx) =>
      registerAppWorkflows(tx, {
        tenantId,
        appId: "k4-reinstall",
        templates: [{ ...calendarCheck, name: "Calendar check v2" }],
      }),
    );

    expect(result.removedWorkflows).toBe(2);
    expect(result.removedRoutines).toBeGreaterThanOrEqual(1);
    expect(result.inserted).toHaveLength(1);

    const after = await listWorkflowsForApp("k4-reinstall");
    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("Calendar check v2");
  });

  it("registerWorkflowsFromDefinition installs the generic-triage stub manifest", async () => {
    const adapter = createDrizzleInstallDb(conn.db);
    await adapter.transaction(async (_db, tx) =>
      registerWorkflowsFromDefinition(tx, tenantId, "generic-triage-def", {
        id: "generic-triage-def",
        workflows: [triageOnInbox],
      }),
    );

    const rows = await listWorkflowsForApp("generic-triage-def");
    expect(rows).toHaveLength(1);
    const triggerBlock = rows[0]?.blocks.find(
      (b) => (b as { type: string }).type === "trigger",
    ) as { config: { eventType: string } } | undefined;
    expect(triggerBlock?.config.eventType).toBe("inbox.item_created");
  });
});

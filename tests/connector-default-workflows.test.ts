// SPDX-License-Identifier: MIT
//
// N5 — Default workflows install on connect, pause on disconnect,
// resume on reconnect, and stay idempotent across all of those.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import type { ConnectorDefinition, DefaultWorkflowSpec } from "@boringos/connector";
import {
  installDefaultWorkflows,
  pauseDefaultWorkflows,
} from "@boringos/core";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

function fakeGoogleSpec(): DefaultWorkflowSpec {
  return {
    tag: "google.gmail-sync",
    name: "Gmail sync",
    blocks: [
      { id: "trigger", name: "trigger", type: "trigger", config: {} },
      {
        id: "fetch",
        name: "fetch",
        type: "connector-action",
        config: {
          connectorKind: "google",
          action: "list_emails",
          inputs: { query: "newer_than:15m" },
        },
      },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    ],
    routine: {
      title: "Gmail sync (every 15 min)",
      cronExpression: "*/15 * * * *",
      timezone: "UTC",
    },
  };
}

function fakeConnector(specs: DefaultWorkflowSpec[]): ConnectorDefinition {
  return {
    kind: "google",
    name: "Google",
    description: "Test connector",
    events: [],
    actions: [],
    createClient: () => ({
      executeAction: async () => ({ success: true }),
    }),
    skillMarkdown: () => "",
    defaultWorkflows: () => specs,
  };
}

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-n5-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5611,
  });
  await createMigrationManager(conn.db).apply();

  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('N5 Test', 'n5-test')
    RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("installDefaultWorkflows", () => {
  it("returns zero counts when the connector ships no defaults", async () => {
    const result = await installDefaultWorkflows(
      conn.db,
      tenantId,
      { ...fakeConnector([]), defaultWorkflows: undefined },
    );
    expect(result).toEqual({ installed: 0, resumed: 0, skipped: 0 });
  });

  it("installs a workflow + routine on first connect", async () => {
    const result = await installDefaultWorkflows(
      conn.db,
      tenantId,
      fakeConnector([fakeGoogleSpec()]),
    );
    expect(result.installed).toBe(1);
    expect(result.resumed).toBe(0);

    // Verify the workflow row was created.
    const wf = await conn.db.execute(sql`
      SELECT id, name, status, type FROM workflows WHERE tenant_id = ${tenantId}
    `);
    const wfRows = wf as unknown as Array<{ id: string; name: string; status: string; type: string }>;
    expect(wfRows.length).toBe(1);
    expect(wfRows[0]?.name).toContain("[connector-default:google.gmail-sync]");
    expect(wfRows[0]?.status).toBe("active");
    expect(wfRows[0]?.type).toBe("system");

    // Verify the routine row was created and active.
    const r = await conn.db.execute(sql`
      SELECT cron_expression, status FROM routines
      WHERE tenant_id = ${tenantId} AND workflow_id = ${wfRows[0]?.id}
    `);
    const rRows = r as unknown as Array<{ cron_expression: string; status: string }>;
    expect(rRows.length).toBe(1);
    expect(rRows[0]?.cron_expression).toBe("*/15 * * * *");
    expect(rRows[0]?.status).toBe("active");
  });

  it("is idempotent on a second call (resume vs duplicate)", async () => {
    const result = await installDefaultWorkflows(
      conn.db,
      tenantId,
      fakeConnector([fakeGoogleSpec()]),
    );
    // No new workflow created — the spec.tag is already present.
    expect(result.installed).toBe(0);
    expect(result.resumed).toBe(1);

    const wf = await conn.db.execute(sql`
      SELECT COUNT(*)::int as n FROM workflows
      WHERE tenant_id = ${tenantId} AND name LIKE '[connector-default:google.gmail-sync]%'
    `);
    expect((wf as unknown as Array<{ n: number }>)[0]?.n).toBe(1);
  });

  it("pauseDefaultWorkflows pauses routines but keeps workflow rows", async () => {
    const result = await pauseDefaultWorkflows(conn.db, tenantId, "google");
    expect(result.paused).toBeGreaterThan(0);

    // Workflow row still exists.
    const wf = await conn.db.execute(sql`
      SELECT COUNT(*)::int as n FROM workflows
      WHERE tenant_id = ${tenantId} AND name LIKE '[connector-default:google.gmail-sync]%'
    `);
    expect((wf as unknown as Array<{ n: number }>)[0]?.n).toBe(1);

    // Routine row still exists, but paused.
    const r = await conn.db.execute(sql`
      SELECT status FROM routines
      WHERE tenant_id = ${tenantId}
        AND description LIKE '[connector-default:google.gmail-sync]%'
    `);
    const rRows = r as unknown as Array<{ status: string }>;
    expect(rRows.length).toBe(1);
    expect(rRows[0]?.status).toBe("paused");
  });

  it("resumes a previously-paused routine on next install (reconnect)", async () => {
    const result = await installDefaultWorkflows(
      conn.db,
      tenantId,
      fakeConnector([fakeGoogleSpec()]),
    );
    expect(result.resumed).toBe(1);

    const r = await conn.db.execute(sql`
      SELECT status FROM routines
      WHERE tenant_id = ${tenantId}
        AND description LIKE '[connector-default:google.gmail-sync]%'
    `);
    expect((r as unknown as Array<{ status: string }>)[0]?.status).toBe("active");
  });
});

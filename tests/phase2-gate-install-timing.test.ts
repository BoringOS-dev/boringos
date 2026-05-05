/**
 * M1 — Phase 2 Gate: end-to-end install timing benchmark.
 *
 * Boots embedded Postgres, builds a kernel install context (K7), installs
 * a CRM-shaped fixture app three times, and asserts each install lands
 * under the 30-second Phase 2 Gate target. Median + p95 are written to
 * docs/tests/phase2-gate-results.md.
 *
 * The fixture mirrors the CRM's manifest shape from boringos-crm/boringos.json
 * (entity types, capabilities, nav, entityActions, settingsPanels) so the
 * benchmark exercises the full kernel pipeline (row + schema + agents +
 * workflows + routes + onTenantCreated). It does NOT import
 * `@boringos-crm/server` directly — that package's typecheck is currently
 * blocked by the un-built `@hebbs/sdk` dependency, which is unrelated to
 * the install timing the gate measures.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createAppRouteRegistry,
  createKernelInstallContext,
} from "@boringos/control-plane";
import type { AppManifest } from "@boringos/app-sdk";
import { defineApp } from "@boringos/app-sdk";
import { InstallRuntime } from "@boringos/shell/runtime/install-runtime.js";

const PHASE2_GATE_LIMIT_MS = 30_000;
const ITERATIONS = 3;
const RESULTS_PATH = join(
  new URL(".", import.meta.url).pathname,
  "..",
  "docs",
  "tests",
  "phase2-gate-results.md",
);

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let bundleDir: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-m1-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5589,
  });
  await createMigrationManager(conn.db).apply();

  // CRM-shaped schema migration. The real CRM ships ~7 DDL statements;
  // we replicate the surface area (tables + indices) so the migration
  // runner does meaningful work.
  bundleDir = mkdtempSync(join(tmpdir(), "bos-m1-bundle-"));
  mkdirSync(join(bundleDir, "schema"), { recursive: true });
  writeFileSync(
    join(bundleDir, "schema", "001_init.sql"),
    `
      CREATE TABLE IF NOT EXISTS m1_crm_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        email TEXT
      );
      CREATE INDEX IF NOT EXISTS m1_crm_contacts_tenant_idx ON m1_crm_contacts(tenant_id);
      CREATE TABLE IF NOT EXISTS m1_crm_companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name TEXT
      );
      CREATE TABLE IF NOT EXISTS m1_crm_pipelines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS m1_crm_pipeline_stages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pipeline_id UUID NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS m1_crm_deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        title TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS m1_crm_deals_tenant_idx ON m1_crm_deals(tenant_id);
      CREATE TABLE IF NOT EXISTS m1_crm_activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        type TEXT NOT NULL
      );
    `,
    "utf8",
  );
}, 180_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

const crmManifest: AppManifest = {
  kind: "app",
  id: "crm",
  version: "0.0.1",
  name: "CRM",
  description: "Phase 2 Gate fixture mirroring boringos-crm/boringos.json",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  schema: "schema",
  entityTypes: [
    { id: "crm_contact", label: "Contact", shareable: true },
    { id: "crm_company", label: "Company", shareable: true },
    { id: "crm_deal", label: "Deal", shareable: true },
    { id: "crm_pipeline", label: "Pipeline" },
    { id: "crm_pipeline_stage", label: "Pipeline Stage" },
    { id: "crm_activity", label: "Activity" },
  ],
  ui: { entry: "dist/ui.js" },
  capabilities: [
    "entities.own:write",
    "entities.core:write",
    "agents:register",
    "workflows:register",
    "routes:register",
    "slots:nav",
  ],
};

function buildCrmDefinition() {
  return defineApp({
    id: "crm",
    agents: [
      { id: "crm.email-lens", name: "CRM Email Lens", persona: "researcher", runtime: "claude" },
      { id: "crm.contact-enrichment", name: "Contact Enrichment", persona: "researcher", runtime: "claude" },
      { id: "crm.company-enrichment", name: "Company Enrichment", persona: "researcher", runtime: "claude" },
      { id: "crm.deal-analyst", name: "Deal Analyst", persona: "researcher", runtime: "claude" },
      { id: "crm.follow-up-writer", name: "Follow-up Writer", persona: "researcher", runtime: "claude" },
    ],
    workflows: [
      {
        id: "crm.email-ingest",
        name: "Email Sync",
        blocks: [{ id: "trigger", name: "trigger", type: "trigger", config: {} }],
        edges: [],
        triggers: [{ type: "cron", cron: "*/15 * * * *" }],
      },
      {
        id: "crm.calendar-check",
        name: "Calendar Check",
        blocks: [{ id: "trigger", name: "trigger", type: "trigger", config: {} }],
        edges: [],
        triggers: [{ type: "cron", cron: "*/30 * * * *" }],
      },
    ],
    routes: Object.assign(
      (router: any) => {
        const sub = router as Hono;
        sub.get("/contacts", (c) => c.json({ contacts: [] }));
        sub.get("/deals", (c) => c.json({ deals: [] }));
      },
      { agentDocs: () => "### CRM API\n- GET /contacts\n- GET /deals" },
    ),
    onTenantCreated: async (ctx) => {
      // Mirror the work tenant.ts does: insert a default pipeline + 7
      // stages so the gate's M3 seeding test has a target to verify.
      const tx = ctx.db as unknown as { execute: (q: any) => Promise<unknown> };
      await tx.execute(sql`
        INSERT INTO m1_crm_pipelines (tenant_id, name)
        VALUES (${ctx.tenantId}, 'Sales Pipeline')
      `);
      const pipelineRow = (await tx.execute(sql`
        SELECT id FROM m1_crm_pipelines
        WHERE tenant_id = ${ctx.tenantId} AND name = 'Sales Pipeline'
        ORDER BY id LIMIT 1
      `)) as Array<{ id: string }>;
      const pipelineId = pipelineRow[0]?.id;
      if (!pipelineId) return;
      const stages = [
        "Qualified",
        "Discovery",
        "Demo",
        "Proposal",
        "Negotiation",
        "Closed Won",
        "Closed Lost",
      ];
      for (let i = 0; i < stages.length; i += 1) {
        await tx.execute(sql`
          INSERT INTO m1_crm_pipeline_stages (pipeline_id, name, sort_order)
          VALUES (${pipelineId}, ${stages[i]}, ${i})
        `);
      }
    },
  });
}

async function freshTenant(): Promise<string> {
  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug)
    VALUES ('M1 Tenant', ${"m1-" + Math.random().toString(36).slice(2, 10)})
    RETURNING id
  `);
  return (inserted as any[])[0].id as string;
}

async function pollUntilActive(tenantId: string): Promise<void> {
  const deadline = Date.now() + PHASE2_GATE_LIMIT_MS;
  while (Date.now() < deadline) {
    const rows = (await conn.db.execute(sql`
      SELECT status FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'crm'
    `)) as Array<{ status: string }>;
    if (rows[0]?.status === "active") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("tenant_apps.status never reached 'active' within the gate");
}

interface RunResult {
  elapsedMs: number;
  tenantId: string;
}

async function runOneInstall(): Promise<RunResult> {
  const tenantId = await freshTenant();
  const coreApp = new Hono();
  const routeRegistry = createAppRouteRegistry();
  routeRegistry.attachTo(coreApp);
  const shellRuntime = new InstallRuntime();
  const events: { type: string; payload: Record<string, unknown> }[] = [];

  const kernel = createKernelInstallContext({
    db: conn.db,
    routeRegistry,
    slotRuntime: {
      installApp: (a) => shellRuntime.installApp(a),
      uninstallApp: (id) => shellRuntime.uninstallApp(id),
    },
    events: { emit: (type, payload) => { events.push({ type, payload }); } },
  });

  const t0 = Date.now();
  await kernel.installApp({
    manifest: crmManifest,
    tenantId,
    bundleDir,
    definition: buildCrmDefinition(),
  });
  await pollUntilActive(tenantId);
  const elapsedMs = Date.now() - t0;
  return { elapsedMs, tenantId };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx]!;
}

function appendResultsReport(elapsed: number[]) {
  const dir = dirname(RESULTS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const med = median(elapsed);
  const p = p95(elapsed);
  const max = Math.max(...elapsed);
  const min = Math.min(...elapsed);
  const stamp = new Date().toISOString();
  const block = `\n## M1 — Install timing (${stamp})\n\n` +
    `| Metric | ms |\n|---|---|\n` +
    `| min | ${min} |\n` +
    `| median | ${med} |\n` +
    `| max | ${max} |\n` +
    `| p95 | ${p} |\n` +
    `| iterations | ${elapsed.length} |\n` +
    `| gate target | ${PHASE2_GATE_LIMIT_MS} |\n\n` +
    `Per-run elapsed (ms): ${elapsed.join(", ")}\n`;
  if (!existsSync(RESULTS_PATH)) {
    writeFileSync(
      RESULTS_PATH,
      "# Phase 2 Gate — Test Results\n\n" +
        "Auto-generated by the M1-M5 vitest suite. Each section is appended on every test-suite run.\n",
    );
  }
  appendFileSync(RESULTS_PATH, block);
}

describe("Phase 2 Gate — install timing benchmark (M1)", () => {
  it(`installs CRM in under ${PHASE2_GATE_LIMIT_MS}ms across ${ITERATIONS} runs`, async () => {
    const elapsed: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const r = await runOneInstall();
      elapsed.push(r.elapsedMs);
      expect(r.elapsedMs).toBeLessThan(PHASE2_GATE_LIMIT_MS);
    }

    const med = median(elapsed);
    const p = p95(elapsed);
    expect(med).toBeLessThan(PHASE2_GATE_LIMIT_MS);
    expect(p).toBeLessThan(PHASE2_GATE_LIMIT_MS);

    appendResultsReport(elapsed);
    // Echo the timing summary so the test log carries the numbers
    // even before the markdown report is opened.
    console.log(
      `[M1] elapsed=${elapsed.join(",")}ms median=${med}ms p95=${p}ms (gate=${PHASE2_GATE_LIMIT_MS}ms)`,
    );
  }, PHASE2_GATE_LIMIT_MS * (ITERATIONS + 1));
});

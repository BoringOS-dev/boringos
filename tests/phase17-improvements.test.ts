/**
 * Phase 17 Smoke Tests — Framework Improvements
 * Custom schema, entity linking, search, event-to-inbox routing
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "improve-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-improve-"));
  const app = new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  });
  return { app, d };
}

function h(tid: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };
}

describe("custom schema integration", () => {
  it("creates user-defined tables on boot", async () => {
    const { app } = await boot(5569);
    app.schema(`
      CREATE TABLE IF NOT EXISTS crm_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        email TEXT,
        company TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const server = await app.listen(0);
    try {
      const db = server.context.db as import("@boringos/db").Db;
      const { sql } = await import("drizzle-orm");
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");

      // Create tenant first
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "CRM Co", slug: "crm-co" });

      // Insert into custom table
      await db.execute(sql`INSERT INTO crm_contacts (tenant_id, name, email, company) VALUES (${tid}, 'Alice', 'alice@acme.com', 'Acme')`);

      // Query it back
      const rows = await db.execute(sql`SELECT name, email FROM crm_contacts`);
      expect((rows as unknown as unknown[]).length).toBe(1);
    } finally { await server.close(); }
  }, 30000);
});

describe("entity linking", () => {
  it("links entities and queries refs", async () => {
    const { app } = await boot(5568);
    const server = await app.listen(0);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, tasks } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Link Co", slug: "link-co" });

      // Create a task
      const taskId = generateId();
      await db.insert(tasks).values({ id: taskId, tenantId: tid, title: "Fix bug", status: "todo", priority: "high", originKind: "manual" });

      // Link task to a "contact" entity
      const linkRes = await fetch(`${server.url}/api/admin/entities/link`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ entityType: "contact", entityId: "contact-123", refType: "task", refId: taskId }),
      });
      expect(linkRes.status).toBe(201);

      // Query refs for the contact
      const refsRes = await fetch(`${server.url}/api/admin/entities/contact/contact-123/refs`, { headers: h(tid) });
      const refs = await refsRes.json() as { refs: Record<string, string[]> };
      expect(refs.refs.task).toContain(taskId);
    } finally { await server.close(); }
  }, 30000);
});

describe("search", () => {
  it("searches across tasks and agents", async () => {
    const { app } = await boot(5567);
    const server = await app.listen(0);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents, tasks } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Search Co", slug: "search-co" });
      await db.insert(agents).values({ id: generateId(), tenantId: tid, name: "Acme Bot", role: "engineer" });
      await db.insert(tasks).values({ id: generateId(), tenantId: tid, title: "Fix Acme login", status: "todo", priority: "high", originKind: "manual" });
      await db.insert(tasks).values({ id: generateId(), tenantId: tid, title: "Unrelated task", status: "todo", priority: "low", originKind: "manual" });

      const res = await fetch(`${server.url}/api/admin/search?q=Acme`, { headers: h(tid) });
      expect(res.status).toBe(200);
      const body = await res.json() as { tasks: unknown[]; agents: unknown[] };
      expect((body.tasks as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect((body.agents as unknown[]).length).toBeGreaterThanOrEqual(1);
    } finally { await server.close(); }
  }, 30000);
});

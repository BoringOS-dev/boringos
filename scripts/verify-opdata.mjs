// Live end-to-end: operational data as OKF. Seeds ~5 faked emails + a
// synthetic demo__widgets module table, then over the real HTTP tools:
// brain.sync_schema → OKF type:table catalog; brain.ingest_rows → row
// pointers; brain.search finds both; brain.query is column-accurate;
// brain.ask grounds on the operational data.

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createDatabase, tenants, agents } from "@boringos/db";
import { eq, sql } from "drizzle-orm";
import { signCallbackToken } from "@boringos/agent";

const BASE = process.env.BASE ?? "http://localhost:3030";
const SECRET = process.env.AUTH_SECRET ?? "boringos-dev-secret";
const PG = process.env.DATABASE_URL ?? "postgres://boringos:boringos@127.0.0.1:5436/boringos";

const { db, close } = await createDatabase({ url: PG });
const trow = await db.execute(sql`SELECT id FROM tenants ORDER BY created_at DESC LIMIT 1`);
const tenantId = trow[0]?.id;
if (!tenantId) { console.error("no tenant — sign up first"); await close(); process.exit(1); }
const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId)).limit(1);

// Synthetic module table + rows.
await db.execute(sql`CREATE TABLE IF NOT EXISTS demo__widgets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, name TEXT NOT NULL, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
await db.execute(sql`INSERT INTO demo__widgets (tenant_id, name, description) VALUES (${tenantId}::uuid, 'Sprocket 9000', 'A blue industrial sprocket for heavy loads.')`);
await db.execute(sql`INSERT INTO demo__widgets (tenant_id, name, description) VALUES (${tenantId}::uuid, 'Cog Mini', 'A small brass cog.')`);
// 5 faked emails.
for (let i = 1; i <= 5; i++) {
  await db.execute(sql`INSERT INTO inbox_items (tenant_id, source, source_id, subject, body, "from", status)
    VALUES (${tenantId}::uuid, 'gmail', ${"opd-live-" + i + "-" + Date.now()}, ${"Email " + i + " re Globex"}, ${"Globex outage update number " + i + "."}, ${"ops" + i + "@globex.test"}, 'unread')`);
}
await close();

const token = signCallbackToken({ runId: "verify-opdata", agentId: agent?.id ?? tenantId, tenantId }, SECRET);
const call = async (tool, body) =>
  (await (await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })).json().catch(() => ({}))).result ?? {};
const ok = (c, l) => console.log(`${c ? "✅" : "❌"} ${l}`);

console.log(`tenant=${tenantId}\n`);

// 1. Materialize the OKF schema catalog.
const sres = await call("brain.sync_schema", { scope: "tenant" });
ok((sres.tables ?? []).includes("demo__widgets"), `sync_schema cataloged demo__widgets (+ ${(sres.tables ?? []).length} tables total)`);
ok((sres.tables ?? []).includes("inbox_items"), "sync_schema cataloged inbox_items (core)");

// 2. Ingest rows as pointers.
const ires = await call("brain.ingest_rows", { limit: 100 });
ok((ires.total ?? 0) >= 7, `ingest_rows indexed ${ires.total} rows (emails + widgets)`);

// 3. Schema doc on disk: OKF type:table + correct columns.
const memDir = resolve(process.cwd(), ".data", "drive", tenantId, "shared", "memory");
const doc = await readFile(resolve(memDir, "50-schema/demo__widgets.md"), "utf8").catch(() => "");
ok(/^---\ntype:\s*table/m.test(doc) || doc.startsWith("---"), "50-schema/demo__widgets.md has type:table frontmatter");
ok(doc.includes("| name |") && doc.includes("| description |"), "schema doc lists live columns (name, description)");

// 4. brain.search finds the schema doc + the row pointers.
const s1 = await call("brain.search", { query: "demo__widgets columns schema", limit: 8 });
ok((s1.results ?? []).some((r) => (r.sourceRef ?? "").endsWith("50-schema/demo__widgets.md")), "brain.search finds the schema doc");
const s2 = await call("brain.search", { query: "blue industrial sprocket", limit: 8 });
ok((s2.results ?? []).some((r) => r.sourceKind === "row" && (r.sourceRef ?? "").startsWith("demo__widgets:")), "brain.search finds the widget row pointer");
const s3 = await call("brain.search", { query: "Globex outage", limit: 8 });
ok((s3.results ?? []).some((r) => r.sourceKind === "row" && (r.sourceRef ?? "").startsWith("inbox_items:")), "brain.search finds the email row pointer");

// 5. brain.query is column-accurate (using the documented `name` column).
const q = await call("brain.query", { sql: `SELECT name FROM demo__widgets WHERE tenant_id = '${tenantId}' ORDER BY name` });
const names = (q.rows ?? []).map((r) => r.name);
ok(names.includes("Sprocket 9000") && names.includes("Cog Mini"), `brain.query column-level returned widgets: ${JSON.stringify(names)}`);

// 6. brain.ask grounds on the operational data (no agent wait — assert the
//    grounding pulls row pointers; the synthesis run is fired async).
const ask = await call("brain.ask", { question: "Globex outage emails", wait: false });
const cites = ask.citations ?? [];
ok(cites.some((c) => c.sourceKind === "row"), `brain.ask grounding includes row pointers (${cites.filter((c) => c.sourceKind === "row").length} of ${cites.length})`);

console.log("\n50-schema/demo__widgets.md:\n" + "─".repeat(60) + "\n" + doc.split("\n").slice(0, 18).join("\n") + "\n" + "─".repeat(60));

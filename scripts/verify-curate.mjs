// Live verification of the curator/lint pass (Unit 3) over the real HTTP
// tool surface. Seeds a messy memory tree on disk (conflict, oversized,
// orphan, broken pointer), runs brain.curate, and asserts the lint +
// idempotency. Also confirms the daily curate routine + workflow seeded.

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, tenants, agents } from "@boringos/db";
import { eq, sql } from "drizzle-orm";
import { signCallbackToken } from "@boringos/agent";

const BASE = process.env.BASE ?? "http://localhost:3030";
const SECRET = process.env.AUTH_SECRET ?? "boringos-dev-secret";
const PG = process.env.DATABASE_URL ?? "postgres://boringos:boringos@127.0.0.1:5436/boringos";

const { db, close } = await createDatabase({ url: PG });
// Newest tenant — so a fresh signup (which fires onTenantCreate → seeds
// BOTH brain routines) is the one we verify against.
const trow = await db.execute(sql`SELECT id FROM tenants ORDER BY created_at DESC LIMIT 1`);
const tenant = trow[0];
if (!tenant) { console.error("no tenant — sign up first"); await close(); process.exit(1); }
const tenantId = tenant.id;
const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId)).limit(1);
const rt = await db.execute(sql`SELECT cron_expression, workflow_id FROM routines WHERE tenant_id=${tenantId} AND title='Daily memory curation' LIMIT 1`);
const wf = await db.execute(sql`SELECT id FROM workflows WHERE tenant_id=${tenantId} AND name='Brain daily curation' LIMIT 1`);
await close();

const token = signCallbackToken({ runId: "verify-curate", agentId: agent?.id ?? tenantId, tenantId }, SECRET);
const call = async (tool, body) =>
  (await (await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })).json().catch(() => ({}))).result ?? {};

const ok = (c, l) => console.log(`${c ? "✅" : "❌"} ${l}`);
const memDir = resolve(process.cwd(), ".data", "drive", tenantId, "shared", "memory");
const w = async (rel, content) => { await mkdir(resolve(memDir, rel, ".."), { recursive: true }); await writeFile(resolve(memDir, rel), content); };
const r = (rel) => readFile(resolve(memDir, rel), "utf8").catch(() => null);
const fexists = (rel) => stat(resolve(memDir, rel)).then(() => true).catch(() => false);

console.log(`tenant=${tenantId}\n`);

// 0. routine + workflow seeded?
ok(Array.isArray(wf) && wf.length === 1, "daily curation workflow seeded");
ok(Array.isArray(rt) && rt.length === 1 && rt[0].cron_expression === "30 3 * * *" && rt[0].workflow_id, "daily routine seeded → workflow (03:30 UTC)");

// 1. Seed a messy tree.
await w("MEMORY.md", "# Memory index\n\n## Index\n- [Gone](10-domains/curate-gone.md) — dead\n- [Acme](10-domains/curate-acme.md) — Enterprise\n");
await w("10-domains/curate-acme.md", "# Curate Acme\n\n- Terms: net-30 (src: task:1)\n- Revised: net-45 (src: task:2)\n");
await w("10-domains/curate-orphan.md", "# Curate Orphan\n\n- A fact (src: task:9)\n");
await w("10-domains/curate-big.md", "# Curate Big\n\n" + Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nline a\nline b\nline c\nline d\n`).join("\n"));

// 2. Curate.
const rep = await call("brain.curate", { scope: "tenant", maxLines: 200, staleDays: 14 });
console.log("curate report:", JSON.stringify({ filesSplit: rep.filesSplit, conflictsSurfaced: rep.conflictsSurfaced, orphansFixed: rep.orphansFixed, brokenPointersFixed: rep.brokenPointersFixed, citationsMissing: rep.citationsMissing }));

ok(rep.filesSplit >= 1, "oversized file split");
ok(await fexists("10-domains/curate-big-part2.md"), "split produced curate-big-part2.md");
ok(rep.conflictsSurfaced >= 1, "contradiction surfaced");
ok((await r("10-domains/curate-acme.md"))?.includes("> CONFLICT: payment terms"), "CONFLICT: block written into curate-acme.md");
ok(rep.orphansFixed >= 1, "orphan pointer added");
const mem = await r("MEMORY.md");
ok(mem?.includes("10-domains/curate-orphan.md"), "MEMORY.md now points to the orphan");
ok(rep.brokenPointersFixed >= 1 && !mem?.includes("curate-gone.md"), "broken pointer removed");

// 3. Idempotent.
const rep2 = await call("brain.curate", { scope: "tenant", maxLines: 200, staleDays: 14 });
ok(rep2.filesSplit === 0 && rep2.conflictsSurfaced === 0 && rep2.orphansFixed === 0, "second pass is a no-op (idempotent)");

console.log("\ncurate-acme.md (with CONFLICT):\n" + "─".repeat(60) + "\n" + (await r("10-domains/curate-acme.md")) + "─".repeat(60));

// Live verification of distillation (Unit 2) over the real HTTP tool
// surface + the on-disk memory tree. Remembers near-duplicate facts +
// a decision today, runs brain.distill, and asserts the compression:
// dedup, promotion to 10-domains/20-decisions + MEMORY.md pointers,
// weekly synthesis. Also confirms the weekly routine + workflow seeded.

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, tenants, agents } from "@boringos/db";
import { eq, sql } from "drizzle-orm";
import { signCallbackToken } from "@boringos/agent";

const BASE = process.env.BASE ?? "http://localhost:3030";
const SECRET = process.env.AUTH_SECRET ?? "boringos-dev-secret";
const PG = process.env.DATABASE_URL ?? "postgres://boringos:boringos@127.0.0.1:5436/boringos";
const DRIVE = resolve(process.cwd(), ".data", "drive");

const { db, close } = await createDatabase({ url: PG });
const [tenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
const tenantId = tenant.id;
const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId)).limit(1);
// Confirm the routine + workflow seeded by the brain lifecycle.
const wf = await db.execute(sql`SELECT id FROM workflows WHERE tenant_id=${tenantId} AND name='Brain weekly distillation' LIMIT 1`);
const rt = await db.execute(sql`SELECT cron_expression, workflow_id FROM routines WHERE tenant_id=${tenantId} AND title='Weekly memory distillation' LIMIT 1`);
await close();

const token = signCallbackToken({ runId: "verify-distill", agentId: agent?.id ?? tenantId, tenantId }, SECRET);
const call = async (tool, body) =>
  (await (await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })).json().catch(() => ({}))).result ?? {};

const ok = (c, l) => console.log(`${c ? "✅" : "❌"} ${l}`);
const memDir = resolve(DRIVE, tenantId, "shared", "memory");
const readMem = (rel) => readFile(resolve(memDir, rel), "utf8").catch(() => null);

console.log(`tenant=${tenantId}\n`);

// 0. Routine + workflow seeded?
ok(Array.isArray(wf) && wf.length === 1, "distillation workflow seeded");
ok(Array.isArray(rt) && rt.length === 1 && rt[0].cron_expression === "0 3 * * 1" && rt[0].workflow_id, "weekly routine seeded → workflow (Mon 03:00 UTC)");

// 1. Remember near-duplicate facts + a decision (today, wikilinked).
const tag = "DISTILL-" + tenantId.slice(0, 4);
await call("brain.remember", { content: `${tag}: [[Umbrella Corp]] renews in October on net-30 terms.`, scope: "tenant" });
await call("brain.remember", { content: `${tag}: [[Umbrella Corp]] renewal is October, net-30.`, scope: "tenant" });
await call("brain.remember", { content: `${tag}: We decided to always bill [[Umbrella Corp]] net-30 going forward.`, scope: "tenant" });

// 2. Distill (wide window to cover today).
const res = await call("brain.distill", { scope: "tenant", windowDays: 90 });
console.log("distill result:", JSON.stringify({ deduped: res.deduped, reinforced: res.reinforced, promotedEntities: res.promotedEntities, promotedDecisions: res.promotedDecisions, weekId: res.weekId }));

ok(res.deduped >= 1, "dedup-reinforce merged the near-duplicate renewal facts");
ok((res.promotedEntities ?? []).includes("umbrella-corp"), "promoted [[Umbrella Corp]] → 10-domains/");
ok((res.promotedDecisions ?? 0) >= 1, "promoted the decision → 20-decisions/");

// 3. On-disk: durable files + pointers + weekly synthesis.
const domain = await readMem("10-domains/umbrella-corp.md");
ok(domain != null && /renews in October|renewal is October/.test(domain), "10-domains/umbrella-corp.md written with the facts");
ok(domain != null && (domain.match(/October/g) ?? []).length >= 1 && !domain.includes("going forward"), "decision kept out of the domain file");

const memIndex = await readMem("MEMORY.md");
ok(memIndex != null && memIndex.includes("10-domains/umbrella-corp.md"), "MEMORY.md has the entity pointer");

const weekly = await readMem(`70-weekly/${res.weekId}.md`);
ok(weekly != null && weekly.includes(`# Week ${res.weekId} synthesis`), `70-weekly/${res.weekId}.md synthesis written`);
ok(memIndex != null && memIndex.includes(`70-weekly/${res.weekId}.md`), "MEMORY.md has the weekly pointer");

const decisionsDir = await readdir(resolve(memDir, "20-decisions")).catch(() => []);
ok(decisionsDir.length >= 1, `20-decisions/ has ${decisionsDir.length} file(s)`);

// 4. Dedup proof: the renewal fact lives ONCE in the mirror now.
const liveRenew = await call("brain.query", {
  sql: `SELECT count(*)::int AS n FROM brain__memories WHERE tenant_id='${tenantId}' AND deleted_at IS NULL AND content ILIKE '%${tag}%renew%October%'`,
});
const n = liveRenew.rows?.[0]?.n;
ok(n === 1, `mirror holds the renewal fact ONCE (count=${n}), not duplicated`);

console.log("\n10-domains/umbrella-corp.md:\n" + "─".repeat(60) + "\n" + (domain ?? "(missing)") + "\n" + "─".repeat(60));

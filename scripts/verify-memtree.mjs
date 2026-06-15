// Live verification of Memory tree v2 (Unit 1) over the real HTTP tool
// surface + the on-disk daily note (the system of record).
//
// Flow: remember two facts the same day → assert ONE 60-daily file with
// TWO fragments on disk → brain.search finds both → brain.forget one →
// assert the block is struck from the file + brain.search excludes it.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase, tenants, agents } from "@boringos/db";
import { eq } from "drizzle-orm";
import { signCallbackToken } from "@boringos/agent";

const BASE = process.env.BASE ?? "http://localhost:3030";
const SECRET = process.env.AUTH_SECRET ?? "boringos-dev-secret";
const PG = process.env.DATABASE_URL ?? "postgres://boringos:boringos@127.0.0.1:5436/boringos";
const DRIVE_ROOT = resolve(process.cwd(), ".data", "drive");

const { db, close } = await createDatabase({ url: PG });
const [tenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
const tenantId = tenant.id;
const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId)).limit(1);
await close();
const token = signCallbackToken({ runId: "verify-memtree", agentId: agent?.id ?? tenantId, tenantId }, SECRET);

async function call(tool, body) {
  const res = await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))).result ?? {};
}

const date = new Date().toISOString().slice(0, 10);
const dailyDisk = resolve(DRIVE_ROOT, tenantId, "shared", "memory", "60-daily", `${date}.md`);
const readDaily = () => readFile(dailyDisk, "utf8").catch(() => "(file missing)");
const markerCount = (s) => (s.match(/<!-- frag /g) ?? []).length;
const ok = (cond, label) => console.log(`${cond ? "✅" : "❌"} ${label}`);

console.log(`tenant=${tenantId}\ndaily note=${dailyDisk}\n`);

// 1. Remember two facts the same day.
const a = await call("brain.remember", {
  content: "MEMTREE-A: The renewal date for [[Soylent Corp]] is October 1.",
  scope: "tenant",
  tags: ["renewal"],
});
const b = await call("brain.remember", {
  content: "MEMTREE-B: The [[Soylent Corp]] account owner is Dana.",
  scope: "tenant",
});
console.log("remember A →", a.memoryId);
console.log("remember B →", b.memoryId);
ok(/#[0-9a-f]{8}$/.test(a.memoryId ?? ""), "A id is a fragment ref <dailyPath>#<subid>");
ok(a.memoryId?.split("#")[0] === b.memoryId?.split("#")[0], "both facts target the SAME daily note");

// 2. On-disk: one file, two fragments, both facts present.
let file = await readDaily();
ok(file.includes(`# ${date}`), "daily note has its date header");
ok(markerCount(file) >= 2, `daily note holds >=2 fragments (found ${markerCount(file)})`);
ok(file.includes("MEMTREE-A") && file.includes("MEMTREE-B"), "both facts are in the file (human-readable)");

// 3. Both recallable via hybrid search.
const s1 = await call("brain.search", { query: "Soylent Corp", limit: 10 });
const hits1 = (s1.results ?? []).map((r) => r.content).join(" | ");
ok(hits1.includes("MEMTREE-A"), "brain.search finds A");
ok(hits1.includes("MEMTREE-B"), "brain.search finds B");

// 4. Forget A → struck from file, gone from search, B survives.
await call("brain.forget", { memoryId: a.memoryId });
file = await readDaily();
ok(!file.includes("MEMTREE-A"), "A is struck from the daily note on disk");
ok(file.includes("MEMTREE-B"), "B still present in the daily note");
ok(markerCount(file) >= 1, `daily note still holds B's fragment (found ${markerCount(file)})`);

const s2 = await call("brain.search", { query: "Soylent Corp", limit: 10 });
const hits2 = (s2.results ?? []).map((r) => r.content).join(" | ");
ok(!hits2.includes("MEMTREE-A"), "brain.search no longer returns A");
ok(hits2.includes("MEMTREE-B"), "brain.search still returns B");

// 5. graph: the [[Soylent Corp]] wikilink wired up from the fragment.
const g = await call("brain.graph", { type: "topic", id: "soylent-corp", direction: "both", depth: 1 });
ok((g.edges ?? []).some((e) => e.edgeType === "mentions"), "graph wired [[Soylent Corp]] from the daily fragment");

console.log("\nDaily note now on disk:\n" + "─".repeat(60) + "\n" + file + "─".repeat(60));

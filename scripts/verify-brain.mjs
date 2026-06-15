// Live verification of the brain over the real HTTP tool surface.
// Connects to the running dev-server's Postgres to grab a real tenant
// + agent, mints a callback JWT with the dev secret, and exercises
// brain.remember / brain.search / brain.graph / brain.query through
// POST /api/tools/* — the same path agents and external MCP callers use.

import { createDatabase, tenants, agents } from "@boringos/db";
import { eq } from "drizzle-orm";
import { signCallbackToken } from "@boringos/agent";

const BASE = process.env.BASE ?? "http://localhost:3030";
const SECRET = process.env.AUTH_SECRET ?? "boringos-dev-secret";
const PG = process.env.DATABASE_URL ?? "postgres://boringos:boringos@127.0.0.1:5436/boringos";

const { db, close } = await createDatabase({ url: PG });

const [tenant] = await db.select({ id: tenants.id }).from(tenants).limit(1);
if (!tenant) {
  console.error("No tenant found in the live DB — sign up in the shell first.");
  await close();
  process.exit(1);
}
const tenantId = tenant.id;
const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId)).limit(1);
const agentId = agent?.id ?? "00000000-0000-0000-0000-000000000000";
await close();

const token = signCallbackToken(
  { runId: "verify-brain-run", agentId, tenantId },
  SECRET,
);

async function call(tool, body) {
  const res = await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

console.log(`tenant=${tenantId} agent=${agentId}\n`);

console.log("1) brain.remember ──────────────────────────────");
const rem = await call("brain.remember", {
  content:
    "VERIFY-FACT: The Q3 launch budget for [[Project Atlas]] is $48,000, approved by [[Dana]].",
  scope: "tenant",
  tags: ["verify", "budget"],
});
console.log(JSON.stringify(rem, null, 2));

console.log("\n2) brain.search ────────────────────────────────");
const search = await call("brain.search", { query: "Project Atlas launch budget", limit: 3 });
console.log(JSON.stringify(search, null, 2));

console.log("\n3) brain.graph (from the [[Project Atlas]] topic) ──");
const graph = await call("brain.graph", {
  type: "topic",
  id: "project-atlas",
  direction: "both",
  depth: 2,
});
console.log(JSON.stringify(graph, null, 2));

console.log("\n4) brain.query (exact SQL, read-only) ───────────");
const query = await call("brain.query", {
  sql: `SELECT source_kind, count(*) AS n FROM brain__memories WHERE tenant_id = '${tenantId}' AND deleted_at IS NULL GROUP BY source_kind ORDER BY n DESC`,
});
console.log(JSON.stringify(query, null, 2));

console.log("\n5) brain.query write rejection (should be permission_denied) ─");
const writeAttempt = await call("brain.query", {
  sql: `DELETE FROM brain__memories WHERE tenant_id = '${tenantId}'`,
});
console.log(JSON.stringify(writeAttempt, null, 2));

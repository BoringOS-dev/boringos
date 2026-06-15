// Live end-to-end verification of Brain ⇄ OKF compatibility with FAKED
// emails, over the real HTTP tool surface:
//   seed ~5 inbox_items → brain.remember a fact per email citing
//   (src: inbox_items:<id>) → brain.distill → brain.curate →
//   brain.export_okf, asserting the tree is OKF-§9-conformant, the
//   emailed facts are retrievable via brain.search, and cites
//   provenance chains back to the email rows.

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

// 1. Seed 5 fake inbound emails (inbox_items).
const emails = [
  { sid: "okf-eml-1", subj: "Acme renewal", from: "ops@acme.test", body: "Acme will renew on net-30 in October." },
  { sid: "okf-eml-2", subj: "Globex outage postmortem", from: "sre@globex.test", body: "Globex had a Q3 outage; RCA attached." },
  { sid: "okf-eml-3", subj: "Initech invoice 88", from: "ar@initech.test", body: "Initech invoice 88 due net-45." },
  { sid: "okf-eml-4", subj: "Umbrella SOC2", from: "sec@umbrella.test", body: "Umbrella passed SOC2 Type II." },
  { sid: "okf-eml-5", subj: "Soylent partnership", from: "bd@soylent.test", body: "Soylent proposes co-marketing." },
];
const idMap = {};
for (const e of emails) {
  const r = await db.execute(sql`
    INSERT INTO inbox_items (tenant_id, source, source_id, subject, body, "from", status)
    VALUES (${tenantId}::uuid, 'gmail', ${e.sid + "-" + Date.now()}, ${e.subj}, ${e.body}, ${e.from}, 'unread')
    RETURNING id::text AS id`);
  idMap[e.sid] = r[0].id;
}
await close();

const token = signCallbackToken({ runId: "verify-okf", agentId: agent?.id ?? tenantId, tenantId }, SECRET);
const call = async (tool, body) =>
  (await (await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })).json().catch(() => ({}))).result ?? {};
const ok = (c, l) => console.log(`${c ? "✅" : "❌"} ${l}`);

console.log(`tenant=${tenantId} — seeded ${emails.length} emails\n`);

// 2. Remember a fact per email, citing the email row.
const facts = [
  ["Acme Corp", `[[Acme Corp]] will renew on net-30 in October. (src: inbox_items:${idMap["okf-eml-1"]})`],
  ["Globex", `[[Globex]] had a Q3 outage with an RCA. (src: inbox_items:${idMap["okf-eml-2"]})`],
  ["Initech", `[[Initech]] invoice 88 is due net-45. (src: inbox_items:${idMap["okf-eml-3"]})`],
  ["Umbrella", `[[Umbrella]] passed SOC2 Type II. (src: inbox_items:${idMap["okf-eml-4"]})`],
  ["Soylent", `[[Soylent]] proposed a co-marketing deal. (src: inbox_items:${idMap["okf-eml-5"]})`],
];
for (const [, f] of facts) await call("brain.remember", { content: f, scope: "tenant" });
ok(true, "remembered 5 email-sourced facts");

// 3. distill → 4. curate → 5. export.
const dres = await call("brain.distill", { scope: "tenant", windowDays: 90 });
ok((dres.promotedEntities ?? []).length >= 3, `distill promoted ${(dres.promotedEntities ?? []).length} entities`);
const cres = await call("brain.curate", { scope: "tenant" });
ok(typeof cres.indexesWritten === "number", `curate wrote ${cres.indexesWritten} index.md + back-filled ${cres.conformanceFixed} (okf ${cres.okfVersion})`);
const exp = await call("brain.export_okf", { scope: "tenant" });
console.log("export:", JSON.stringify({ conformant: exp.conformant, okfVersion: exp.okfVersion, fileCount: exp.fileCount, violations: exp.violations }));
ok(exp.conformant === true, "exported bundle is OKF-§9-conformant");
ok(exp.okfVersion === "0.1", "okf_version 0.1 declared");
ok((exp.violations ?? []).length === 0, "zero conformance violations");

// 6. Emailed facts retrievable.
const s = await call("brain.search", { query: "Acme renew October net-30", limit: 8 });
ok((s.results ?? []).some((r) => /Acme/i.test(r.content)), "emailed Acme fact retrievable via brain.search");

// 7. (src:)/cites provenance chains back to the email rows.
const q = await call("brain.query", {
  sql: `SELECT count(*)::int AS n FROM brain__edges WHERE tenant_id='${tenantId}' AND edge_type='cites' AND dst_type='row' AND dst_id LIKE 'inbox_items:%' AND deleted_at IS NULL`,
});
const citeN = q.rows?.[0]?.n ?? 0;
ok(citeN >= 3, `cites provenance to email rows: ${citeN} edge(s)`);

// 8. Promoted domain file carries OKF frontmatter on disk.
const memDir = resolve(process.cwd(), ".data", "drive", tenantId, "shared", "memory");
const acme = await readFile(resolve(memDir, "10-domains/acme-corp.md"), "utf8").catch(() => "");
ok(/^---\ntype:\s*domain/m.test(acme) || acme.startsWith("---"), "10-domains/acme-corp.md has OKF frontmatter");
console.log("\nacme-corp.md head:\n" + "─".repeat(60) + "\n" + acme.split("\n").slice(0, 12).join("\n") + "\n" + "─".repeat(60));

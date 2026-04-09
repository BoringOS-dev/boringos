/**
 * Phase 16 Smoke Tests — Final Tier 3: Onboarding, Device Auth, Evals, Inbox
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "final-admin";

async function boot(port: number) {
  const { BoringOS } = await import("@boringos/core");
  const d = await mkdtemp(join(tmpdir(), "boringos-final-"));
  return new BoringOS({
    database: { embedded: true, dataDir: d, port },
    drive: { root: join(d, "drive") },
    auth: { secret: "s", adminKey: KEY },
  }).listen(0);
}

function h(tid: string) {
  return { "Content-Type": "application/json", "X-API-Key": KEY, "X-Tenant-Id": tid };
}

describe("onboarding", () => {
  it("creates state and advances through steps", async () => {
    const server = await boot(5573);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Onboard Co", slug: "onboard-co" });

      // Get initial state (auto-creates)
      const r1 = await fetch(`${server.url}/api/admin/onboarding`, { headers: h(tid) });
      const s1 = await r1.json() as { currentStep: number; completed: boolean };
      expect(s1.currentStep).toBe(1);
      expect(s1.completed).toBe(false);

      // Complete step 1
      await fetch(`${server.url}/api/admin/onboarding/complete-step`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ step: 1, metadata: { orgName: "Acme" } }),
      });

      // Complete all remaining steps
      for (let step = 2; step <= 5; step++) {
        await fetch(`${server.url}/api/admin/onboarding/complete-step`, {
          method: "POST", headers: h(tid),
          body: JSON.stringify({ step }),
        });
      }

      // Verify completed
      const r2 = await fetch(`${server.url}/api/admin/onboarding`, { headers: h(tid) });
      const s2 = await r2.json() as { completed: boolean; completedSteps: number[] };
      expect(s2.completed).toBe(true);
      expect(s2.completedSteps).toHaveLength(5);
    } finally { await server.close(); }
  }, 30000);
});

describe("device auth", () => {
  it("generates device code and polls for approval", async () => {
    const server = await boot(5572);
    try {
      // Generate device code
      const codeRes = await fetch(`${server.url}/api/auth/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(codeRes.status).toBe(200);
      const code = await codeRes.json() as { deviceCode: string; userCode: string };
      expect(code.deviceCode).toBeTruthy();
      expect(code.userCode).toHaveLength(8);

      // Poll — should be pending
      const pollRes = await fetch(`${server.url}/api/auth/device/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: code.deviceCode }),
      });
      expect(pollRes.status).toBe(202);

      // Verify (simulate browser approval)
      const { generateId } = await import("@boringos/shared");
      const verifyRes = await fetch(`${server.url}/api/auth/device/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: code.userCode, sessionToken: "cli-session-123", userId: "user-1", tenantId: generateId() }),
      });

      // Poll again — should be approved
      const pollRes2 = await fetch(`${server.url}/api/auth/device/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: code.deviceCode }),
      });
      expect(pollRes2.status).toBe(200);
      const approved = await pollRes2.json() as { status: string; token: string };
      expect(approved.status).toBe("approved");
      expect(approved.token).toBe("cli-session-123");
    } finally { await server.close(); }
  }, 30000);
});

describe("evals", () => {
  it("creates eval and lists runs", async () => {
    const server = await boot(5571);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, agents } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Eval Co", slug: "eval-co" });
      const agentId = generateId();
      await db.insert(agents).values({ id: agentId, tenantId: tid, name: "Eval Bot", role: "engineer" });

      // Create eval
      const evalRes = await fetch(`${server.url}/api/admin/evals`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({
          name: "Code Quality",
          testCases: [
            { input: "Write a hello world function", expectedOutput: "function" },
            { input: "Fix the bug in auth.ts", expectedOutput: "fixed" },
          ],
        }),
      });
      expect(evalRes.status).toBe(201);
      const ev = await evalRes.json() as { id: string; testCases: unknown[] };
      expect(ev.testCases).toHaveLength(2);

      // Start run
      const runRes = await fetch(`${server.url}/api/admin/evals/${ev.id}/run`, {
        method: "POST", headers: h(tid),
        body: JSON.stringify({ agentId }),
      });
      expect(runRes.status).toBe(201);
      const run = await runRes.json() as { runId: string; totalCases: number };
      expect(run.totalCases).toBe(2);

      // List evals
      const listRes = await fetch(`${server.url}/api/admin/evals`, { headers: h(tid) });
      const list = await listRes.json() as { evals: unknown[] };
      expect(list.evals).toHaveLength(1);
    } finally { await server.close(); }
  }, 30000);
});

describe("inbox", () => {
  it("creates inbox item, reads it, creates task from it", async () => {
    const server = await boot(5570);
    try {
      const { generateId } = await import("@boringos/shared");
      const { tenants, inboxItems } = await import("@boringos/db");
      const db = server.context.db as import("@boringos/db").Db;
      const tid = generateId();
      await db.insert(tenants).values({ id: tid, name: "Inbox Co", slug: "inbox-co" });

      // Insert inbox item directly (normally comes from connectors)
      const itemId = generateId();
      await db.insert(inboxItems).values({
        id: itemId,
        tenantId: tid,
        source: "email",
        subject: "Bug report from customer",
        body: "The login page is broken when using Safari.",
        from: "customer@example.com",
      });

      // List unread
      const listRes = await fetch(`${server.url}/api/admin/inbox`, { headers: h(tid) });
      const list = await listRes.json() as { items: Array<{ id: string; status: string }> };
      expect(list.items).toHaveLength(1);
      expect(list.items[0].status).toBe("unread");

      // Read item (marks as read)
      const readRes = await fetch(`${server.url}/api/admin/inbox/${itemId}`, { headers: h(tid) });
      const item = await readRes.json() as { subject: string; status: string };
      expect(item.subject).toContain("Bug report");

      // Create task from inbox item
      const taskRes = await fetch(`${server.url}/api/admin/inbox/${itemId}/create-task`, {
        method: "POST", headers: h(tid),
      });
      expect(taskRes.status).toBe(201);
      const task = await taskRes.json() as { taskId: string };
      expect(task.taskId).toBeTruthy();

      // Archive
      await fetch(`${server.url}/api/admin/inbox/${itemId}/archive`, {
        method: "POST", headers: h(tid),
      });

      // List unread — should be empty now
      const listRes2 = await fetch(`${server.url}/api/admin/inbox`, { headers: h(tid) });
      const list2 = await listRes2.json() as { items: unknown[] };
      expect(list2.items).toHaveLength(0);
    } finally { await server.close(); }
  }, 30000);
});

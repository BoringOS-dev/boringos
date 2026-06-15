// Distillation — Unit 2 (docs/brain.md §4.2/§4.5). Seeds multi-day daily
// captures, runs distill(), and asserts the compression: dedup-reinforce,
// promotion into 10-domains/20-decisions with MEMORY.md pointers, archive
// on change, weekly synthesis — all deterministic + idempotent, FTS floor.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { testDbConfig } from "./_helpers.js";
import { createLocalStorage } from "@boringos/drive";
import {
  createIndexer,
  distill,
  isoWeekId,
  dailyNoteHeader,
  renderFragmentBlock,
  nullEmbedder,
  __resetCapabilityCache,
} from "@boringos/brain";
import type { Db, DatabaseConnection } from "@boringos/db";

const TENANT = "22222222-2222-2222-2222-2222222222bb";

describe("brain — distillation (Unit 2)", () => {
  let dataDir: string;
  let driveDir: string;
  let dbConn: DatabaseConnection;
  let db: Db;
  let drive: ReturnType<typeof createLocalStorage>;
  let indexer: ReturnType<typeof createIndexer>;

  async function seedDay(date: string, facts: Array<{ subid: string; text: string }>): Promise<void> {
    const path = `shared/memory/60-daily/${date}.md`;
    let content = dailyNoteHeader(date);
    for (const f of facts) {
      content += renderFragmentBlock({
        kind: "mem",
        subid: f.subid,
        ts: `${date}T09:00:00Z`,
        header: "### 09:00",
        body: f.text,
      });
    }
    await drive.write(`${TENANT}/${path}`, content);
    await indexer.indexMemoryFile({ tenantId: TENANT, path, content, scope: "tenant" });
  }

  const read = (rel: string) => drive.readText(`${TENANT}/${rel}`).catch(() => null);
  const exists = (rel: string) => drive.exists(`${TENANT}/${rel}`);
  const liveCountLike = async (needle: string) =>
    (
      (await db.execute(sql`
        SELECT count(*)::int AS n FROM brain__memories
        WHERE tenant_id = ${TENANT}::uuid AND deleted_at IS NULL AND content ILIKE ${"%" + needle + "%"}
      `)) as unknown as Array<{ n: number }>
    )[0].n;

  beforeAll(async () => {
    __resetCapabilityCache();
    const { createDatabase, createMigrationManager } = await import("@boringos/db");
    dataDir = await mkdtemp(join(tmpdir(), "brain-distill-pg-"));
    driveDir = await mkdtemp(join(tmpdir(), "brain-distill-drive-"));
    dbConn = (await createDatabase(testDbConfig(dataDir, 5613))) as DatabaseConnection;
    db = dbConn.db;
    await createMigrationManager(db as never).apply();
    await db.execute(sql`
      INSERT INTO tenants (id, name, slug) VALUES (${TENANT}::uuid, 'Distill Test', 'distill-test')
      ON CONFLICT (id) DO NOTHING
    `);
    drive = createLocalStorage({ root: driveDir });
    indexer = createIndexer({ db, embedder: nullEmbedder, hasVector: false });
  }, 90_000);

  afterAll(async () => {
    if (dbConn) await dbConn.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(driveDir, { recursive: true, force: true });
  });

  it("isoWeekId is stable and well-formed", () => {
    expect(isoWeekId(new Date("2026-06-12T00:00:00Z"))).toMatch(/^2026-W\d{2}$/);
    // Two dates in the same ISO week match.
    expect(isoWeekId(new Date("2026-06-08T00:00:00Z"))).toBe(
      isoWeekId(new Date("2026-06-12T00:00:00Z")),
    );
  });

  it("distills a multi-day window: dedup + promote + archive + weekly", async () => {
    // Day 1 & 2: the SAME fact (near-duplicate across days).
    await seedDay("2026-06-10", [{ subid: "a1", text: "[[Acme]] renews in October on net-30 terms." }]);
    await seedDay("2026-06-11", [{ subid: "b1", text: "[[Acme]] renews in October on net-30 terms." }]);
    // Day 3: a distinct entity fact, a decision, another mention.
    await seedDay("2026-06-12", [
      { subid: "c1", text: "[[Acme]] primary contact is Dana." },
      { subid: "c2", text: "We decided to always use [[Acme]] net-30 going forward." },
      { subid: "c3", text: "Globex competes with [[Acme]] on price." },
    ]);

    const now = new Date("2026-06-12T23:00:00Z");
    const weekId = isoWeekId(now);
    const res = await distill({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now, windowDays: 7 });

    // ── dedup-reinforce ──
    expect(res.deduped).toBeGreaterThanOrEqual(1); // the two "renews" facts merged
    expect(res.reinforced).toBeGreaterThanOrEqual(1);

    // ── promotion: entity + decision ──
    expect(res.promotedEntities).toContain("acme");
    expect(res.promotedDecisions).toBeGreaterThanOrEqual(1);

    const acme = await read("shared/memory/10-domains/acme.md");
    expect(acme).not.toBeNull();
    expect(acme).toContain("primary contact is Dana");
    // dedup proof: the duplicated "renews" fact appears ONCE, not twice.
    expect((acme!.match(/renews in October/g) ?? []).length).toBe(1);
    // The decision is NOT in the domain file (it went to 20-decisions).
    expect(acme).not.toContain("going forward");

    // decision file exists.
    const decisions = await drive.list?.(`${TENANT}/shared/memory/20-decisions`).catch(() => []);
    expect(Array.isArray(decisions) ? decisions.length : 0).toBeGreaterThanOrEqual(1);

    // ── MEMORY.md pointers ──
    const mem = await read("shared/memory/MEMORY.md");
    expect(mem).toContain("10-domains/acme.md");
    expect(mem).toContain(`70-weekly/${weekId}.md`);

    // ── weekly synthesis ──
    const weekly = await read(`shared/memory/70-weekly/${weekId}.md`);
    expect(weekly).not.toBeNull();
    expect(weekly).toContain(`# Week ${weekId} synthesis`);
    expect(weekly).toContain("[[acme]]");
    expect(weekly).toContain("Daily activity");

    // ── no duplication in the mirror: promoted daily rows retired, the
    //    fact lives once (in the domain file's row). ──
    expect(await liveCountLike("renews in October")).toBe(1);

    // First run archives nothing (durable files are new).
    expect(res.archived).toBe(0);
  });

  it("is idempotent and archives on change", async () => {
    const now = new Date("2026-06-12T23:30:00Z");
    // Re-run with no new data → unchanged durable files → no archives.
    const again = await distill({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now, windowDays: 7 });
    expect(again.archived).toBe(0);

    // Change a fact about Acme on a new day, re-distill → the prior
    // 10-domains/acme.md is retired to 99-archive/.
    await seedDay("2026-06-12", [
      { subid: "c1", text: "[[Acme]] primary contact is Dana." },
      { subid: "d1", text: "[[Acme]] moved its renewal to November." },
    ]);
    const now2 = new Date("2026-06-12T23:45:00Z");
    const week = isoWeekId(now2);
    const res = await distill({ db, drive, indexer }, { tenantId: TENANT, scope: "tenant", now: now2, windowDays: 7 });
    expect(res.archived).toBeGreaterThanOrEqual(1);
    expect(await exists(`shared/memory/99-archive/acme-${week}.md`)).toBe(true);
  });
});

/**
 * Default-app provisioning (TASK-E3)
 *
 * Verifies the loop that calls C5's installApp for each catalog entry,
 * the partial-failure semantics (signup succeeds even when an app's
 * pre-install fails), and the result shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installDefaultApps, type InstallContext, type DefaultAppEntry, type TenantAppRow } from "@boringos/control-plane";
import type { AppManifest } from "@boringos/app-sdk";

// Load the real default-app manifests so this test catches regressions
// in either E1 or E2's manifest the moment they break the schema.
const FRAMEWORK = resolve(__dirname, "..");
const triageManifest = JSON.parse(
  readFileSync(`${FRAMEWORK}/apps/generic-triage/boringos.json`, "utf-8"),
) as AppManifest;
const replierManifest = JSON.parse(
  readFileSync(`${FRAMEWORK}/apps/generic-replier/boringos.json`, "utf-8"),
) as AppManifest;

const realCatalog: DefaultAppEntry[] = [
  { id: "generic-triage", manifest: triageManifest },
  { id: "generic-replier", manifest: replierManifest },
];

function makeCtx(overrides: Partial<{
  insertImpl: (row: TenantAppRow) => Promise<void>;
}> = {}) {
  const inserts: TenantAppRow[] = [];
  const slotInstalls: string[] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];

  const ctx: InstallContext = {
    db: {
      insertTenantApp: async (row) => {
        inserts.push(row);
        if (overrides.insertImpl) await overrides.insertImpl(row);
      },
      deleteTenantApp: async () => {},
    },
    slotRuntime: {
      installApp: ({ appId }) => {
        slotInstalls.push(appId);
        return { appId };
      },
      uninstallApp: () => {},
    },
    events: {
      emit: (type, payload) => {
        events.push({ type, payload });
      },
    },
  };

  return { ctx, inserts, slotInstalls, events };
}

// ── Happy path ─────────────────────────────────────────────────────────

describe("installDefaultApps — happy path", () => {
  it("installs every catalog entry", async () => {
    const { ctx, inserts, slotInstalls, events } = makeCtx();

    const result = await installDefaultApps(ctx, "t-1", realCatalog);

    expect(result.allInstalled).toBe(true);
    expect(result.outcomes.length).toBe(2);
    expect(result.outcomes.every((o) => o.installed)).toBe(true);
    expect(result.outcomes.map((o) => o.appId)).toEqual([
      "generic-triage",
      "generic-replier",
    ]);

    expect(inserts.map((r) => r.appId)).toEqual([
      "generic-triage",
      "generic-replier",
    ]);
    expect(slotInstalls).toEqual(["generic-triage", "generic-replier"]);
    expect(events.map((e) => e.payload.appId)).toEqual([
      "generic-triage",
      "generic-replier",
    ]);
  });

  it("each outcome carries the install record", async () => {
    const { ctx } = makeCtx();
    const result = await installDefaultApps(ctx, "t-1", realCatalog);
    expect(result.outcomes[0]?.record?.appId).toBe("generic-triage");
    expect(result.outcomes[1]?.record?.appId).toBe("generic-replier");
  });
});

// ── Partial failure ────────────────────────────────────────────────────

describe("installDefaultApps — partial failure does not abort the loop", () => {
  it("one app failing still installs the other and returns outcomes for both", async () => {
    let calls = 0;
    const { ctx } = makeCtx({
      insertImpl: async () => {
        calls++;
        if (calls === 1) throw new Error("simulated DB hiccup");
      },
    });

    const result = await installDefaultApps(ctx, "t-1", realCatalog);

    expect(result.allInstalled).toBe(false);
    expect(result.outcomes).toHaveLength(2);

    const first = result.outcomes[0]!;
    const second = result.outcomes[1]!;

    expect(first.appId).toBe("generic-triage");
    expect(first.installed).toBe(false);
    expect(first.error?.message).toMatch(/DB hiccup/);

    expect(second.appId).toBe("generic-replier");
    expect(second.installed).toBe(true);
  });

  it("does not throw — caller (signup flow) sees outcomes, never an exception", async () => {
    const { ctx } = makeCtx({
      insertImpl: async () => {
        throw new Error("everything down");
      },
    });

    // Should not throw; should resolve with all-failed outcomes.
    const result = await installDefaultApps(ctx, "t-1", realCatalog);
    expect(result.allInstalled).toBe(false);
    expect(result.outcomes.every((o) => !o.installed)).toBe(true);
  });
});

// ── Catalog shape ──────────────────────────────────────────────────────

describe("installDefaultApps — empty catalog", () => {
  it("returns allInstalled=true and empty outcomes when catalog is empty", async () => {
    const { ctx } = makeCtx();
    const result = await installDefaultApps(ctx, "t-1", []);
    expect(result.allInstalled).toBe(true);
    expect(result.outcomes).toEqual([]);
  });
});

/**
 * Uninstall pipeline (TASK-C6)
 *
 * Verifies soft + hard uninstall modes, cascade warnings, and the
 * not-installed / missing-adapter error paths.
 */
import { describe, it, expect } from "vitest";
import {
  uninstallApp,
  UninstallError,
  type UninstallContext,
  type AppLinkRow,
  type TenantAppRow,
} from "@boringos/control-plane";

const installedRow: TenantAppRow = {
  tenantId: "t-1",
  appId: "crm",
  version: "1.0.0",
  status: "active",
  capabilities: [],
  manifestHash: "abc",
};

function makeCtx(overrides: Partial<{
  existing: TenantAppRow | null;
  links: AppLinkRow[];
  hardDeleteAppData: (tenantId: string, appId: string) => Promise<void>;
}> = {}): {
  ctx: UninstallContext;
  calls: {
    marks: Array<[string, string]>;
    deletes: Array<[string, string]>;
    hardDeletes: Array<[string, string]>;
    slotUninstalls: string[];
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  };
} {
  const calls = {
    marks: [] as Array<[string, string]>,
    deletes: [] as Array<[string, string]>,
    hardDeletes: [] as Array<[string, string]>,
    slotUninstalls: [] as string[],
    events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  };

  const existing = overrides.existing === undefined ? installedRow : overrides.existing;
  const links = overrides.links ?? [];

  const ctx: UninstallContext = {
    db: {
      getTenantApp: async () => existing,
      listIncomingLinks: async () => links,
      markTenantAppUninstalling: async (tenantId, appId) => {
        calls.marks.push([tenantId, appId]);
      },
      deleteTenantApp: async (tenantId, appId) => {
        calls.deletes.push([tenantId, appId]);
      },
      hardDeleteAppData: overrides.hardDeleteAppData
        ? async (tenantId, appId) => {
            calls.hardDeletes.push([tenantId, appId]);
            await overrides.hardDeleteAppData!(tenantId, appId);
          }
        : undefined,
    },
    slotRuntime: {
      installApp: () => ({ appId: "noop" }),
      uninstallApp: (appId) => calls.slotUninstalls.push(appId),
    },
    events: {
      emit: (type, payload) => {
        calls.events.push({ type, payload });
      },
    },
  };

  return { ctx, calls };
}

// ── Soft uninstall ──────────────────────────────────────────────────────

describe("uninstallApp — soft", () => {
  it("unregisters slots, marks uninstalling, emits event", async () => {
    const { ctx, calls } = makeCtx();

    const result = await uninstallApp(ctx, {
      tenantId: "t-1",
      appId: "crm",
      mode: "soft",
    });

    expect(result).toEqual({ uninstalled: true, cascade: [], mode: "soft" });
    expect(calls.slotUninstalls).toEqual(["crm"]);
    expect(calls.marks).toEqual([["t-1", "crm"]]);
    expect(calls.deletes).toEqual([]);
    expect(calls.hardDeletes).toEqual([]);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]?.type).toBe("app.uninstalled");
    expect(calls.events[0]?.payload.mode).toBe("soft");
  });

  it("throws if app is not installed", async () => {
    const { ctx } = makeCtx({ existing: null });

    await expect(
      uninstallApp(ctx, { tenantId: "t-1", appId: "crm", mode: "soft" }),
    ).rejects.toThrow(UninstallError);
  });
});

// ── Hard uninstall ──────────────────────────────────────────────────────

describe("uninstallApp — hard", () => {
  it("calls hardDeleteAppData + deleteTenantApp + slot unregister", async () => {
    const { ctx, calls } = makeCtx({
      hardDeleteAppData: async () => {},
    });

    const result = await uninstallApp(ctx, {
      tenantId: "t-1",
      appId: "crm",
      mode: "hard",
    });

    expect(result.uninstalled).toBe(true);
    expect(result.mode).toBe("hard");
    expect(calls.slotUninstalls).toEqual(["crm"]);
    expect(calls.hardDeletes).toEqual([["t-1", "crm"]]);
    expect(calls.deletes).toEqual([["t-1", "crm"]]);
    expect(calls.marks).toEqual([]);
    expect(calls.events[0]?.payload.mode).toBe("hard");
  });

  it("throws if hardDeleteAppData adapter is not wired", async () => {
    const { ctx, calls } = makeCtx({});

    await expect(
      uninstallApp(ctx, { tenantId: "t-1", appId: "crm", mode: "hard" }),
    ).rejects.toThrow(/no hardDeleteAppData adapter/);

    // Nothing should have been touched.
    expect(calls.slotUninstalls).toEqual([]);
    expect(calls.deletes).toEqual([]);
  });
});

// ── Cascade ─────────────────────────────────────────────────────────────

describe("uninstallApp — cascade", () => {
  it("returns cascade and aborts when other apps depend (no force)", async () => {
    const { ctx, calls } = makeCtx({
      links: [
        {
          tenantId: "t-1",
          sourceAppId: "accounts",
          targetAppId: "crm",
          capability: "entities.crm:read",
        },
      ],
    });

    const result = await uninstallApp(ctx, {
      tenantId: "t-1",
      appId: "crm",
      mode: "soft",
    });

    expect(result.uninstalled).toBe(false);
    expect(result.cascade).toHaveLength(1);
    expect(result.cascade[0]?.sourceAppId).toBe("accounts");

    // Nothing was actually uninstalled.
    expect(calls.slotUninstalls).toEqual([]);
    expect(calls.marks).toEqual([]);
    expect(calls.events).toEqual([]);
  });

  it("force=true proceeds despite cascade and includes it in the event", async () => {
    const { ctx, calls } = makeCtx({
      links: [
        {
          tenantId: "t-1",
          sourceAppId: "accounts",
          targetAppId: "crm",
          capability: "entities.crm:read",
        },
      ],
    });

    const result = await uninstallApp(ctx, {
      tenantId: "t-1",
      appId: "crm",
      mode: "soft",
      force: true,
    });

    expect(result.uninstalled).toBe(true);
    expect(result.cascade).toHaveLength(1);
    expect(calls.marks).toHaveLength(1);
    expect(calls.events[0]?.payload.cascade).toEqual([
      { sourceAppId: "accounts", capability: "entities.crm:read" },
    ]);
  });

  it("event-emit failure does not break the uninstall result", async () => {
    const { ctx, calls } = makeCtx();
    ctx.events.emit = () => {
      throw new Error("bus down");
    };

    const result = await uninstallApp(ctx, {
      tenantId: "t-1",
      appId: "crm",
      mode: "soft",
    });

    expect(result.uninstalled).toBe(true);
    expect(calls.marks).toHaveLength(1);
  });
});

/**
 * Install pipeline (TASK-C5)
 *
 * Verifies the orchestration logic. Each integration point (db, slot
 * runtime, event bus) is mocked with a recording stub so tests can
 * assert call sequence + rollback behavior. Real Drizzle/kernel
 * wiring is its own task.
 */
import { describe, it, expect } from "vitest";
import {
  installApp,
  InstallError,
  type InstallContext,
  type TenantAppRow,
} from "@boringos/control-plane";
import type { AppManifest, ConnectorManifest } from "@boringos/app-sdk";

// ── Fixtures ────────────────────────────────────────────────────────────

const validAppManifest: AppManifest = {
  kind: "app",
  id: "crm",
  version: "1.0.0",
  name: "CRM",
  description: "…",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [{ id: "crm_contact", label: "Contact" }],
  ui: { entry: "dist/ui.js" },
  capabilities: ["entities.own:write", "slots:nav"],
};

const validConnectorManifest: ConnectorManifest = {
  kind: "connector",
  id: "slack",
  version: "1.0.0",
  name: "Slack",
  description: "…",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "MIT",
  entry: "dist/index.js",
  auth: { type: "oauth2", provider: "slack", scopes: [] },
  events: [],
  actions: [],
  capabilities: [],
};

function makeCtx(overrides: Partial<{
  insertTenantApp: (row: TenantAppRow) => Promise<void>;
  deleteTenantApp: (tenantId: string, appId: string) => Promise<void>;
  getTenantApp: (tenantId: string, appId: string) => Promise<TenantAppRow | null>;
  slotInstallApp: (args: { appId: string; version: string }) => { appId: string };
  slotUninstallApp: (appId: string) => void;
  emit: (type: string, payload: Record<string, unknown>) => void;
}> = {}): {
  ctx: InstallContext;
  calls: {
    inserts: TenantAppRow[];
    deletes: Array<[string, string]>;
    slotInstalls: Array<{ appId: string; version: string }>;
    slotUninstalls: string[];
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  };
} {
  const calls = {
    inserts: [] as TenantAppRow[],
    deletes: [] as Array<[string, string]>,
    slotInstalls: [] as Array<{ appId: string; version: string }>,
    slotUninstalls: [] as string[],
    events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  };

  const ctx: InstallContext = {
    db: {
      insertTenantApp: async (row) => {
        calls.inserts.push(row);
        if (overrides.insertTenantApp) await overrides.insertTenantApp(row);
      },
      deleteTenantApp: async (tenantId, appId) => {
        calls.deletes.push([tenantId, appId]);
        if (overrides.deleteTenantApp) await overrides.deleteTenantApp(tenantId, appId);
      },
      getTenantApp: overrides.getTenantApp,
    },
    slotRuntime: {
      installApp: (args) => {
        calls.slotInstalls.push({ appId: args.appId, version: args.version });
        if (overrides.slotInstallApp) return overrides.slotInstallApp(args);
        return { appId: args.appId };
      },
      uninstallApp: (appId) => {
        calls.slotUninstalls.push(appId);
        if (overrides.slotUninstallApp) overrides.slotUninstallApp(appId);
      },
    },
    events: {
      emit: (type, payload) => {
        calls.events.push({ type, payload });
        if (overrides.emit) overrides.emit(type, payload);
      },
    },
  };

  return { ctx, calls };
}

// ── Happy paths ─────────────────────────────────────────────────────────

describe("installApp — happy paths", () => {
  it("inserts the row, registers slots, and emits app.installed", async () => {
    const { ctx, calls } = makeCtx();

    const record = await installApp(ctx, {
      manifest: validAppManifest,
      tenantId: "t-1",
      manifestHash: "abc123",
    });

    expect(record.appId).toBe("crm");
    expect(record.version).toBe("1.0.0");
    expect(record.tenantId).toBe("t-1");
    expect(record.manifestHash).toBe("abc123");

    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      tenantId: "t-1",
      appId: "crm",
      version: "1.0.0",
      status: "active",
      capabilities: ["entities.own:write", "slots:nav"],
      manifestHash: "abc123",
    });

    expect(calls.slotInstalls).toHaveLength(1);
    expect(calls.slotInstalls[0]).toEqual({ appId: "crm", version: "1.0.0" });

    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]?.type).toBe("app.installed");
    expect(calls.events[0]?.payload).toMatchObject({
      tenantId: "t-1",
      appId: "crm",
      version: "1.0.0",
    });

    expect(calls.deletes).toHaveLength(0);
  });

  it("works for connector manifests too", async () => {
    const { ctx, calls } = makeCtx();
    const record = await installApp(ctx, {
      manifest: validConnectorManifest,
      tenantId: "t-1",
    });
    expect(record.appId).toBe("slack");
    expect(calls.inserts).toHaveLength(1);
    expect(calls.slotInstalls).toHaveLength(1);
  });

  it("call order: insert → slot register → emit", async () => {
    const order: string[] = [];
    const { ctx } = makeCtx({
      insertTenantApp: async () => { order.push("insert"); },
      slotInstallApp: () => { order.push("slot"); return { appId: "crm" }; },
      emit: () => { order.push("emit"); },
    });

    await installApp(ctx, { manifest: validAppManifest, tenantId: "t-1" });

    expect(order).toEqual(["insert", "slot", "emit"]);
  });
});

// ── Validation rollback ─────────────────────────────────────────────────

describe("installApp — validation failures", () => {
  it("throws InstallError before any DB write on schema fail", async () => {
    const { ctx, calls } = makeCtx();
    await expect(
      installApp(ctx, { manifest: {}, tenantId: "t-1" }),
    ).rejects.toThrow(InstallError);
    expect(calls.inserts).toEqual([]);
    expect(calls.slotInstalls).toEqual([]);
    expect(calls.events).toEqual([]);
  });

  it("InstallError carries structured issues", async () => {
    const { ctx } = makeCtx();
    try {
      await installApp(ctx, { manifest: {}, tenantId: "t-1" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InstallError);
      expect((e as InstallError).issues.length).toBeGreaterThan(0);
      expect((e as InstallError).issues[0]?.layer).toBe("schema");
    }
  });
});

// ── Atomic rollback paths ───────────────────────────────────────────────

describe("installApp — atomic rollback", () => {
  it("rolls back the DB row when slot registration fails", async () => {
    const { ctx, calls } = makeCtx({
      slotInstallApp: () => {
        throw new Error("slot registration boom");
      },
    });

    await expect(
      installApp(ctx, { manifest: validAppManifest, tenantId: "t-1" }),
    ).rejects.toThrow(InstallError);

    // Insert happened, then delete (rollback) happened.
    expect(calls.inserts).toHaveLength(1);
    expect(calls.deletes).toEqual([["t-1", "crm"]]);
    expect(calls.events).toEqual([]); // never emitted
  });

  it("propagates DB insert failure (no rollback needed; nothing was committed)", async () => {
    const { ctx, calls } = makeCtx({
      insertTenantApp: async () => {
        throw new Error("db boom");
      },
    });

    await expect(
      installApp(ctx, { manifest: validAppManifest, tenantId: "t-1" }),
    ).rejects.toThrow(/db boom/);

    expect(calls.slotInstalls).toEqual([]);
    expect(calls.deletes).toEqual([]);
  });

  it("event-emit failure does not roll back the install", async () => {
    const { ctx, calls } = makeCtx({
      emit: () => {
        throw new Error("event bus down");
      },
    });

    const record = await installApp(ctx, {
      manifest: validAppManifest,
      tenantId: "t-1",
    });

    expect(record.appId).toBe("crm");
    expect(calls.inserts).toHaveLength(1);
    expect(calls.slotInstalls).toHaveLength(1);
    expect(calls.deletes).toEqual([]); // not rolled back
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────

describe("installApp — idempotency", () => {
  it("re-install replaces the prior install", async () => {
    let stored: TenantAppRow | null = {
      tenantId: "t-1",
      appId: "crm",
      version: "1.0.0",
      status: "active",
      capabilities: [],
      manifestHash: "old-hash",
    };

    const { ctx, calls } = makeCtx({
      getTenantApp: async (tenantId, appId) =>
        stored && stored.tenantId === tenantId && stored.appId === appId ? stored : null,
      deleteTenantApp: async () => {
        stored = null;
      },
    });

    const record = await installApp(ctx, {
      manifest: { ...validAppManifest, version: "1.0.1" },
      tenantId: "t-1",
      manifestHash: "new-hash",
    });

    expect(record.version).toBe("1.0.1");
    expect(record.manifestHash).toBe("new-hash");

    // Prior install was uninstalled (slot + db delete), then new
    // install ran (slot install + db insert).
    expect(calls.slotUninstalls).toEqual(["crm"]);
    expect(calls.deletes).toEqual([["t-1", "crm"]]);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.slotInstalls).toHaveLength(1);
  });

  it("first install (no existing row) does not call uninstall", async () => {
    const { ctx, calls } = makeCtx({
      getTenantApp: async () => null,
    });

    await installApp(ctx, { manifest: validAppManifest, tenantId: "t-1" });

    expect(calls.slotUninstalls).toEqual([]);
  });
});

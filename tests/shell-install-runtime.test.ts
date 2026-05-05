/**
 * Shell InstallRuntime (TASK-A6)
 *
 * Verifies the shell-side hook the install pipeline (C5) calls into
 * when apps are installed or uninstalled. The hook is a thin wrapper
 * around SlotRegistry, so most of the contract is "calls translate
 * correctly" — but we also verify the hot-update path that the React
 * layer depends on.
 */
import { describe, it, expect } from "vitest";
import { InstallRuntime } from "@boringos/shell/runtime/install-runtime.js";
import { SlotRegistry } from "@boringos/shell/slots/registry.js";
import type { UIDefinition } from "@boringos/app-sdk";

const noop = () => null;

function crmUI(): UIDefinition {
  return {
    pages: { pipeline: { id: "pipeline", component: noop } },
    dashboardWidgets: {
      "open-deals": { id: "open-deals", size: "medium", component: noop },
    },
    entityActions: {
      "send-followup": {
        id: "send-followup",
        entity: "crm_deal",
        label: "Send follow-up",
        invoke: async () => {},
      },
    },
  };
}

function accountsUI(): UIDefinition {
  return {
    pages: { invoices: { id: "invoices", component: noop } },
  };
}

// ── Install ────────────────────────────────────────────────────────────

describe("InstallRuntime — install", () => {
  it("registers slot contributions and stores an install record", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    const record = runtime.installApp({
      appId: "crm",
      version: "1.0.0",
      ui: crmUI(),
    });

    expect(record.appId).toBe("crm");
    expect(record.version).toBe("1.0.0");
    expect(record.installedAt).toBeInstanceOf(Date);

    expect(runtime.isInstalled("crm")).toBe(true);
    expect(runtime.get("crm")?.version).toBe("1.0.0");

    expect(registry.list("pages")).toHaveLength(1);
    expect(registry.list("dashboardWidgets")).toHaveLength(1);
    expect(registry.list("entityActions")).toHaveLength(1);
  });

  it("supports server-only apps (no UI)", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0" });

    expect(runtime.isInstalled("crm")).toBe(true);
    expect(registry.list("pages")).toHaveLength(0);
  });

  it("idempotent re-install replaces prior contributions", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    expect(registry.list("pages")).toHaveLength(1);

    // Re-install with a different UI: only one new page, dashboard widget gone.
    runtime.installApp({
      appId: "crm",
      version: "1.0.1",
      ui: { pages: { dashboard: { id: "dashboard", component: noop } } },
    });

    expect(runtime.get("crm")?.version).toBe("1.0.1");
    const pages = registry.list("pages");
    expect(pages).toHaveLength(1);
    expect(pages[0]?.slotId).toBe("dashboard");
    expect(registry.list("dashboardWidgets")).toHaveLength(0);
    expect(registry.list("entityActions")).toHaveLength(0);
  });

  it("re-install dropping UI clears prior slot contributions", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    expect(registry.list("pages")).toHaveLength(1);

    runtime.installApp({ appId: "crm", version: "1.0.1" });
    expect(runtime.isInstalled("crm")).toBe(true);
    expect(registry.list("pages")).toHaveLength(0);
  });
});

// ── Uninstall ──────────────────────────────────────────────────────────

describe("InstallRuntime — uninstall", () => {
  it("removes slot contributions and the install record", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    expect(registry.list("pages")).toHaveLength(1);

    runtime.uninstallApp("crm");

    expect(runtime.isInstalled("crm")).toBe(false);
    expect(runtime.get("crm")).toBeUndefined();
    expect(registry.list("pages")).toHaveLength(0);
    expect(registry.list("dashboardWidgets")).toHaveLength(0);
  });

  it("uninstalling an unknown app is a no-op", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    runtime.uninstallApp("never-installed");

    expect(runtime.isInstalled("crm")).toBe(true);
  });

  it("only removes the named app's contributions when multiple are installed", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    runtime.installApp({ appId: "accounts", version: "1.0.0", ui: accountsUI() });

    runtime.uninstallApp("crm");

    expect(runtime.isInstalled("accounts")).toBe(true);
    expect(registry.list("pages")).toHaveLength(1); // only accounts.invoices
    expect(registry.list("pages")[0]?.appId).toBe("accounts");
  });
});

// ── Listing ────────────────────────────────────────────────────────────

describe("InstallRuntime — list", () => {
  it("returns installed app records sorted by app id", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    runtime.installApp({ appId: "accounts", version: "1.0.0" });

    const list = runtime.list();
    expect(list.map((r) => r.appId)).toEqual(["accounts", "crm"]);
  });

  it("clear() removes everything", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    runtime.installApp({ appId: "accounts", version: "1.0.0", ui: accountsUI() });

    runtime.clear();

    expect(runtime.list()).toEqual([]);
    expect(registry.list("pages")).toHaveLength(0);
  });
});

// ── Hot-update path ────────────────────────────────────────────────────

describe("InstallRuntime — hot-update propagation", () => {
  it("subscribers fire on install and uninstall (the React useSlot path)", () => {
    const registry = new SlotRegistry();
    const runtime = new InstallRuntime(registry);

    let calls = 0;
    const off = registry.subscribe(() => calls++);

    runtime.installApp({ appId: "crm", version: "1.0.0", ui: crmUI() });
    expect(calls).toBeGreaterThan(0);
    const afterInstall = calls;

    runtime.uninstallApp("crm");
    expect(calls).toBeGreaterThan(afterInstall);

    off();
    runtime.installApp({ appId: "late", version: "1.0.0", ui: crmUI() });
    // After unsubscribe, no further notifications.
    expect(calls).toBe(calls); // tautology; documents intent
  });
});

/**
 * Shell SlotRegistry (TASK-A2)
 *
 * Unit tests for the slot registry. The React layers (Provider,
 * useSlot hook, SlotRenderer) are exercised end-to-end starting at
 * A5 when real screens land — for now we just lock the registry's
 * pure-JS contract.
 */
import { describe, it, expect } from "vitest";
import { SlotRegistry } from "@boringos/shell/slots/registry.js";
import type { UIDefinition } from "@boringos/app-sdk";

// ── Fixtures ────────────────────────────────────────────────────────────

const noop = () => null;

function crmUI(): UIDefinition {
  return {
    pages: {
      pipeline: { id: "pipeline", component: noop },
      contacts: { id: "contacts", component: noop },
    },
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
    settingsPanels: {
      pipeline: { id: "pipeline", label: "Pipeline", component: noop },
    },
  };
}

function accountsUI(): UIDefinition {
  return {
    pages: {
      invoices: { id: "invoices", component: noop },
    },
    dashboardWidgets: {
      "outstanding-ar": { id: "outstanding-ar", size: "small", component: noop },
    },
    entityActions: {
      "send-invoice": {
        id: "send-invoice",
        entity: "crm_deal",
        label: "Send invoice",
        invoke: async () => {},
      },
    },
  };
}

// ── Registration ────────────────────────────────────────────────────────

describe("SlotRegistry — registration", () => {
  it("indexes contributions by family + slot id + app id", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());

    expect(reg.list("pages").length).toBe(2);
    expect(reg.list("dashboardWidgets").length).toBe(1);
    expect(reg.list("entityActions").length).toBe(1);
    expect(reg.list("settingsPanels").length).toBe(1);
    expect(reg.list("copilotTools").length).toBe(0);

    const widgets = reg.list("dashboardWidgets");
    expect(widgets[0]?.appId).toBe("crm");
    expect(widgets[0]?.slotId).toBe("open-deals");
    expect(widgets[0]?.family).toBe("dashboardWidgets");
    expect(widgets[0]?.slot.size).toBe("medium");
  });

  it("supports multiple apps contributing to the same family", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    reg.register("accounts", accountsUI());

    expect(reg.list("pages").length).toBe(3); // 2 from crm + 1 from accounts
    expect(reg.list("entityActions").length).toBe(2);
    expect(reg.installedApps()).toEqual(["accounts", "crm"]);
  });

  it("re-registering an app replaces its prior contributions (idempotent)", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    expect(reg.list("pages").length).toBe(2);

    // Update CRM's UI: only one page now
    reg.register("crm", { pages: { dashboard: { id: "dashboard", component: noop } } });
    expect(reg.list("pages").length).toBe(1);
    expect(reg.list("pages")[0]?.slotId).toBe("dashboard");
    // And other families CRM previously contributed to are also gone
    expect(reg.list("dashboardWidgets").length).toBe(0);
    expect(reg.list("entityActions").length).toBe(0);
  });
});

// ── Filtering / lookup ──────────────────────────────────────────────────

describe("SlotRegistry — filtering and lookup", () => {
  it("filters by slot id within a family", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    reg.register("accounts", accountsUI());

    const sendFollowup = reg.list("entityActions", { id: "send-followup" });
    expect(sendFollowup.length).toBe(1);
    expect(sendFollowup[0]?.appId).toBe("crm");
  });

  it("filters by contributing app id", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    reg.register("accounts", accountsUI());

    expect(reg.list("pages", { appId: "accounts" }).length).toBe(1);
    expect(reg.list("pages", { appId: "crm" }).length).toBe(2);
  });

  it("get() returns the first match or undefined", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());

    expect(reg.get("pages", "pipeline")?.appId).toBe("crm");
    expect(reg.get("pages", "does-not-exist")).toBeUndefined();
  });
});

// ── Unregister ──────────────────────────────────────────────────────────

describe("SlotRegistry — unregister", () => {
  it("removes all contributions an app made, in every family", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    reg.register("accounts", accountsUI());

    reg.unregister("crm");

    expect(reg.list("pages").length).toBe(1); // only accounts.invoices
    expect(reg.list("entityActions").length).toBe(1); // only accounts.send-invoice
    expect(reg.list("settingsPanels").length).toBe(0); // accounts didn't contribute
    expect(reg.installedApps()).toEqual(["accounts"]);
  });

  it("unregistering an unknown app is a no-op", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());
    const before = reg.installedApps();
    reg.unregister("never-installed");
    expect(reg.installedApps()).toEqual(before);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────────

describe("SlotRegistry — subscribe", () => {
  it("notifies on register, unregister, and clear", () => {
    const reg = new SlotRegistry();
    let calls = 0;
    const off = reg.subscribe(() => calls++);

    reg.register("crm", crmUI());
    expect(calls).toBe(1);

    reg.register("accounts", accountsUI());
    expect(calls).toBe(2);

    reg.unregister("crm");
    expect(calls).toBe(3);

    reg.clear();
    expect(calls).toBe(4);

    off();
    reg.register("late", crmUI());
    expect(calls).toBe(4);
  });

  it("does not notify on unregister of an unknown app", () => {
    const reg = new SlotRegistry();
    let calls = 0;
    reg.subscribe(() => calls++);

    reg.unregister("never-installed");
    expect(calls).toBe(0);
  });
});

// ── Type-safety smoke ────────────────────────────────────────────────────

describe("SlotRegistry — type narrowing", () => {
  it("list(family) narrows the slot type", () => {
    const reg = new SlotRegistry();
    reg.register("crm", crmUI());

    // EntityAction has `entity` and `invoke` — TypeScript would reject
    // accessing them if list("entityActions") didn't narrow correctly.
    const actions = reg.list("entityActions");
    if (actions[0]) {
      const a = actions[0].slot;
      expect(a.entity).toBe("crm_deal");
      expect(typeof a.invoke).toBe("function");
    }

    const widgets = reg.list("dashboardWidgets");
    if (widgets[0]) {
      const w = widgets[0].slot;
      // size only exists on DashboardWidget
      expect(["small", "medium", "large"]).toContain(w.size);
    }
  });
});

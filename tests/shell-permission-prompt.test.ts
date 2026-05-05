/**
 * PermissionPrompt — canonical component (TASK-C7)
 *
 * Tests the pure capability-grouping helper. The React component
 * itself is exercised end-to-end via the existing Apps screen Vite
 * boot probe; full DOM-level render testing arrives when the test
 * harness picks up jsdom.
 */
import { describe, it, expect } from "vitest";
import {
  groupCapabilities,
  CAPABILITY_CATEGORIES,
} from "@boringos/shell/components/capabilityCategories.js";

describe("groupCapabilities", () => {
  it("groups a CRM-shaped capability set into the right categories", () => {
    const groups = groupCapabilities([
      "entities.own:write",
      "entities.core:write",
      "agents:register",
      "events:emit:crm.*",
      "events:subscribe:inbox.item_created",
      "slots:nav",
      "slots:dashboard.widget",
      "connectors:use:google",
      "memory:write",
    ]);
    const map = Object.fromEntries(groups.map((g) => [g.label, g.items]));
    expect(map["Data"]).toEqual(["entities.own:write", "entities.core:write"]);
    expect(map["Agents & Workflows"]).toEqual([
      "agents:register",
      "events:emit:crm.*",
      "events:subscribe:inbox.item_created",
    ]);
    expect(map["UI"]).toEqual(["slots:nav", "slots:dashboard.widget"]);
    expect(map["Integrations"]).toEqual(["connectors:use:google"]);
    expect(map["Memory"]).toEqual(["memory:write"]);
    expect(map["Inbox"]).toBeUndefined();
  });

  it("each capability lands in the first matching category", () => {
    // events:* matches "Agents & Workflows"; nothing should land elsewhere
    const groups = groupCapabilities(["events:emit:slack.*"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Agents & Workflows");
  });

  it("unknown capabilities go to an Other group", () => {
    const groups = groupCapabilities(["weirdcap:foo", "xyz"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Other");
    expect(groups[0]?.items).toEqual(["weirdcap:foo", "xyz"]);
  });

  it("returns no groups for an empty input", () => {
    expect(groupCapabilities([])).toEqual([]);
  });

  it("only returns non-empty groups", () => {
    const groups = groupCapabilities(["entities.own:write"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Data");
  });

  it("handles inbox category", () => {
    const groups = groupCapabilities(["inbox:read", "inbox:write"]);
    expect(groups[0]?.label).toBe("Inbox");
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("CAPABILITY_CATEGORIES is well-formed", () => {
    for (const c of CAPABILITY_CATEGORIES) {
      expect(typeof c.label).toBe("string");
      expect(typeof c.matches).toBe("function");
    }
  });
});

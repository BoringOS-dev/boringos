/**
 * Manifest validator (TASK-C4)
 *
 * Two layers covered: schema validation + capability-honesty.
 */
import { describe, it, expect } from "vitest";
import {
  validateManifestFull,
  checkCapabilityHonesty,
} from "@boringos/control-plane";
import type { AppManifest } from "@boringos/app-sdk";

const validApp: AppManifest = {
  kind: "app",
  id: "crm",
  version: "1.0.0",
  name: "CRM",
  description: "Contacts, companies, deals.",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [{ id: "crm_contact", label: "Contact" }],
  ui: { entry: "dist/ui.js" },
  capabilities: ["entities.own:write", "slots:nav"],
};

// ── Schema layer ────────────────────────────────────────────────────────

describe("validateManifestFull — schema layer", () => {
  it("accepts a valid manifest", () => {
    const result = validateManifestFull(validApp);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a manifest missing required fields", () => {
    const result = validateManifestFull({});
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.layer).toBe("schema");
    expect(result.errors[0]?.severity).toBe("error");
  });

  it("rejects unknown kind value", () => {
    const result = validateManifestFull({ ...validApp, kind: "plugin" });
    expect(result.ok).toBe(false);
  });

  it("does not run honesty check when schema fails", () => {
    const result = validateManifestFull({}, "bundle text with useConnector('google')");
    // Schema fails first; honesty results never appear.
    expect(result.warnings).toEqual([]);
  });
});

// ── Honesty layer ───────────────────────────────────────────────────────

describe("checkCapabilityHonesty", () => {
  it("returns no issues when bundle does not call any tracked SDK methods", () => {
    const issues = checkCapabilityHonesty(validApp, "console.log('nothing relevant')");
    expect(issues).toEqual([]);
  });

  it("flags useConnector('google') without connectors:use:google", () => {
    const issues = checkCapabilityHonesty(
      validApp,
      "const g = useConnector('google'); g.list_emails();",
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.path).toBe("connectors:use:google");
  });

  it("does not flag when capability is declared", () => {
    const m: AppManifest = {
      ...validApp,
      capabilities: [...validApp.capabilities, "connectors:use:google"],
    };
    const issues = checkCapabilityHonesty(
      m,
      'const g = useConnector("google"); g.list_emails();',
    );
    expect(issues).toEqual([]);
  });

  it("flags tasks.create() without entities.core:write", () => {
    const issues = checkCapabilityHonesty(
      validApp,
      "await tasks.create({ title: 'x' });",
    );
    expect(issues.some((i) => i.path === "entities.core:write")).toBe(true);
  });

  it("flags inbox.write() and memory.write() and memory.recall()", () => {
    const issues = checkCapabilityHonesty(
      validApp,
      "inbox.write({...}); memory.write('k', v); memory.recall('k');",
    );
    const paths = issues.map((i) => i.path).sort();
    expect(paths).toEqual(["inbox:write", "memory:read", "memory:write"]);
  });

  it("wildcard capability covers a specific scope", () => {
    const m: AppManifest = {
      ...validApp,
      capabilities: ["connectors:use:*"],
    };
    const issues = checkCapabilityHonesty(m, 'useConnector("google");');
    expect(issues).toEqual([]);
  });
});

// ── Integration: validateManifestFull with bundle text ──────────────────

describe("validateManifestFull — full pipeline", () => {
  it("schema-valid + honesty-clean returns ok with zero issues", () => {
    const m: AppManifest = {
      ...validApp,
      capabilities: [...validApp.capabilities, "connectors:use:google"],
    };
    const result = validateManifestFull(m, 'useConnector("google");');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("schema-valid + honesty-undeclared returns ok with warnings", () => {
    const result = validateManifestFull(validApp, 'useConnector("google");');
    expect(result.ok).toBe(true); // honesty is warning in v1
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]?.layer).toBe("honesty");
  });
});

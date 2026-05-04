/**
 * Manifest validation (TASK-D1)
 *
 * Verifies that @boringos/app-sdk's validateManifest() function correctly
 * accepts well-formed connector and app manifests, and produces structured
 * errors for malformed ones.
 */
import { describe, it, expect } from "vitest";
import {
  validateManifest,
  isConnectorManifest,
  isAppManifest,
  MANIFEST_SCHEMA,
  type ConnectorManifest,
  type AppManifest,
} from "@boringos/app-sdk";

// ── Fixtures ────────────────────────────────────────────────────────────

const validConnector: ConnectorManifest = {
  kind: "connector",
  id: "slack",
  version: "1.0.0",
  name: "Slack",
  description: "Send and receive messages.",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "MIT",
  entry: "dist/index.js",
  auth: {
    type: "oauth2",
    provider: "slack",
    scopes: ["channels:read", "chat:write"],
  },
  events: [
    { type: "slack.message_received", description: "Message in a channel." },
  ],
  actions: [
    {
      name: "send_message",
      description: "Post a message.",
      inputSchema: "schemas/send_message.input.json",
    },
  ],
  capabilities: [
    "auth:oauth:slack",
    "events:emit:slack.*",
    "actions:expose:1",
  ],
};

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
  entityTypes: [
    { id: "crm_contact", label: "Contact", shareable: true },
    { id: "crm_deal", label: "Deal" },
  ],
  ui: {
    entry: "dist/ui.js",
    nav: [{ id: "pipeline", label: "Pipeline" }],
  },
  capabilities: ["entities.own:write", "slots:nav"],
};

// ── Schema export ───────────────────────────────────────────────────────

describe("MANIFEST_SCHEMA export", () => {
  it("exposes the JSON Schema as a readable object", () => {
    expect(MANIFEST_SCHEMA).toBeDefined();
    expect(MANIFEST_SCHEMA["$id"]).toBe(
      "https://boringos.dev/schemas/manifest.schema.json"
    );
    expect(MANIFEST_SCHEMA["$schema"]).toBe(
      "https://json-schema.org/draft/2020-12/schema"
    );
  });
});

// ── Connector manifest ──────────────────────────────────────────────────

describe("validateManifest — connector variant", () => {
  it("accepts a valid Slack-style ConnectorManifest", () => {
    const result = validateManifest(validConnector);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("isConnectorManifest narrows the type", () => {
    expect(isConnectorManifest(validConnector)).toBe(true);
    expect(isConnectorManifest(validApp)).toBe(false);
  });

  it("rejects a connector missing required fields", () => {
    const broken = { ...validConnector };
    // @ts-expect-error — intentionally remove a required field
    delete broken.entry;
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message?.includes("entry"))).toBe(true);
  });

  it("rejects a connector with an invalid id (not kebab-case)", () => {
    const broken = { ...validConnector, id: "Slack_Connector" };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.endsWith("/id"))).toBe(true);
  });

  it("rejects a connector with a non-semver version", () => {
    const broken = { ...validConnector, version: "v1" };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.endsWith("/version"))).toBe(true);
  });

  it("rejects an action missing inputSchema", () => {
    const broken = {
      ...validConnector,
      actions: [
        // @ts-expect-error — missing required inputSchema
        { name: "send_message", description: "..." },
      ],
    };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
  });
});

// ── App manifest ────────────────────────────────────────────────────────

describe("validateManifest — app variant", () => {
  it("accepts a valid CRM-style AppManifest", () => {
    const result = validateManifest(validApp);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("isAppManifest narrows the type", () => {
    expect(isAppManifest(validApp)).toBe(true);
    expect(isAppManifest(validConnector)).toBe(false);
  });

  it('rejects hosting != "in-process" (Phase 0 decision)', () => {
    const broken = { ...validApp, hosting: "remote" as const };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.endsWith("/hosting"))).toBe(true);
  });

  it("rejects an entity type with non-snake_case id", () => {
    const broken = {
      ...validApp,
      entityTypes: [{ id: "CrmContact", label: "Contact" }],
    };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path.startsWith("/entityTypes"))
    ).toBe(true);
  });

  it("rejects an app missing the ui field", () => {
    const broken: Partial<AppManifest> = { ...validApp };
    // @ts-expect-error — intentionally remove a required field
    delete broken.ui;
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message?.includes("ui"))).toBe(true);
  });
});

// ── Discriminator behavior ──────────────────────────────────────────────

describe("validateManifest — discriminator", () => {
  it('rejects an unknown kind value', () => {
    const broken = { ...validConnector, kind: "plugin" };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest(undefined).valid).toBe(false);
    expect(validateManifest("not a manifest").valid).toBe(false);
    expect(validateManifest(42).valid).toBe(false);
  });

  it("returns a structured ValidationError shape", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    for (const err of result.errors) {
      expect(typeof err.path).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });
});

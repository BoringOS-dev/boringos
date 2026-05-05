/**
 * L3 — validate CRM's boringos.json end-to-end through the framework's
 * install-pipeline validator. Schema layer must pass with zero errors;
 * capability-honesty warnings are acceptable in v1 but printed for
 * tracking.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateManifestFull } from "@boringos/control-plane";

const CRM_MANIFEST_PATH = join(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
  "boringos-crm",
  "boringos.json",
);

describe("CRM manifest — end-to-end validation", () => {
  it("loads and parses boringos.json", () => {
    const raw = readFileSync(CRM_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe("app");
    expect(parsed.id).toBe("crm");
  });

  it("schema validation passes with zero errors", () => {
    const raw = readFileSync(CRM_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    const result = validateManifestFull(manifest);

    if (!result.ok) {
      // L3 spec: "If schema fails, the test exits with the Phase 1 SDK
      // gap that needs fixing — STOP and fix before proceeding."
      // Print so the gap is visible in CI.
      console.error("CRM manifest validation errors:", result.errors);
    }

    expect(result.ok).toBe(true);
    const schemaErrors = (result.errors ?? []).filter(
      (e) => e.layer === "schema",
    );
    expect(schemaErrors).toEqual([]);
  });

  it("reports capability-honesty warnings without failing v1", () => {
    const raw = readFileSync(CRM_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    // Pass empty bundleText so capability-honesty checks run against
    // an empty bundle. In production K10 would pass the compiled
    // bundle text; for v1 we accept warnings here.
    const result = validateManifestFull(manifest, "");

    const warnings = result.warnings ?? [];
    if (warnings.length > 0) {
      // Document — these are the actionable items for Phase 3.
      console.warn(
        `[L3] CRM manifest warnings (${warnings.length} — acceptable in v1):`,
      );
      for (const w of warnings) {
        console.warn(`  - ${w.layer}: ${w.message}`);
      }
    }

    // Schema layer must still pass.
    expect(result.ok).toBe(true);
  });

  it("CRM declares the entity types CRM port relies on", () => {
    const raw = readFileSync(CRM_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    const ids = (manifest.entityTypes ?? []).map(
      (e: { id: string }) => e.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        "crm_contact",
        "crm_company",
        "crm_deal",
        "crm_pipeline",
        "crm_pipeline_stage",
        "crm_activity",
      ]),
    );
    const dealEntry = (manifest.entityTypes as Array<{ id: string; shareable?: boolean }>).find(
      (e) => e.id === "crm_deal",
    );
    expect(dealEntry?.shareable).toBe(true);
  });

  it("CRM declares every capability the spec requires for Phase 2", () => {
    const raw = readFileSync(CRM_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    const capabilities = manifest.capabilities ?? [];
    expect(capabilities).toEqual(
      expect.arrayContaining([
        "entities.own:write",
        "entities.core:write",
        "agents:register",
        "workflows:register",
        "contextProviders:register",
        "routes:register",
        "slots:nav",
        "slots:dashboard.widget",
        "slots:entity.detail",
        "slots:entity.action",
        "slots:settings.panel",
        "slots:copilot.tool",
        "connectors:use:google",
        "connectors:use:slack",
        "memory:read",
        "memory:write",
      ]),
    );
  });
});

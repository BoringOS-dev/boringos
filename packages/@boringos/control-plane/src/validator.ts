// SPDX-License-Identifier: BUSL-1.1
//
// Manifest validator (TASK-C4).
//
// Two layers:
//   1. SCHEMA validation — delegates to @boringos/app-sdk's
//      validateManifest, which compiles the JSON Schema in
//      schemas/manifest.schema.json against a Draft 2020-12 validator.
//   2. CAPABILITY HONESTY — sanity-checks the manifest's declared
//      capabilities against what the bundle actually does. Strict
//      static analysis is out of scope for v1; the v1 honesty check
//      catches the common "manifest claims something the code can't
//      possibly do" failures by greppable patterns (e.g. claiming
//      `connectors:use:google` while the bundle never imports the
//      Google connector). Stricter analysis lands in Phase 4 with
//      the marketplace's review pipeline.

import {
  validateManifest as schemaValidate,
  type Manifest,
  type ValidationError as SchemaError,
} from "@boringos/app-sdk";

export interface ValidationIssue {
  /** "schema" — JSON Schema violation; "honesty" — capability mismatch. */
  layer: "schema" | "honesty";
  /** "error" stops the install; "warning" surfaces but allows. */
  severity: "error" | "warning";
  /** Human-readable message. */
  message: string;
  /** Optional JSON Pointer for schema issues, capability scope for honesty. */
  path?: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function fromSchemaError(e: SchemaError): ValidationIssue {
  return {
    layer: "schema",
    severity: "error",
    message: e.message,
    path: e.path,
  };
}

/**
 * Patterns the honesty check looks for in the bundle text. Each entry
 * means: "if the bundle text matches this regex, the manifest must
 * declare a capability matching `expectedScope`".
 *
 * The matchers stay deliberately small — they're not a full SDK call
 * graph, just sanity checks. Phase 4's marketplace adds AST-level
 * verification.
 */
interface HonestyRule {
  pattern: RegExp;
  /** Returns the capability scope the bundle's code implies. */
  expectedScope: (match: RegExpMatchArray) => string;
  description: string;
}

const HONESTY_RULES: HonestyRule[] = [
  {
    pattern: /useConnector\(\s*["']([a-z][a-z0-9-]*)["']\s*\)/g,
    expectedScope: (m) => `connectors:use:${m[1]}`,
    description: "useConnector() implies connectors:use:<id>",
  },
  {
    pattern: /tasks\.create\s*\(/g,
    expectedScope: () => "entities.core:write",
    description: "tasks.create() implies entities.core:write",
  },
  {
    pattern: /inbox\.write\s*\(/g,
    expectedScope: () => "inbox:write",
    description: "inbox.write() implies inbox:write",
  },
  {
    pattern: /memory\.write\s*\(/g,
    expectedScope: () => "memory:write",
    description: "memory.write() implies memory:write",
  },
  {
    pattern: /memory\.recall\s*\(/g,
    expectedScope: () => "memory:read",
    description: "memory.recall() implies memory:read",
  },
];

function capabilityCovered(
  declared: readonly string[],
  needed: string,
): boolean {
  if (declared.includes(needed)) return true;
  // Wildcard cover: `events:emit:slack.*` covers `events:emit:slack.message_received`.
  for (const d of declared) {
    if (!d.endsWith(":*")) continue;
    const prefix = d.slice(0, -1); // drop trailing *
    if (needed.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Scan a bundle's source text for capability-implying patterns and
 * verify each one is covered by the manifest's declared capabilities.
 *
 * Returns warnings (not errors): the v1 honesty check intentionally
 * does not block installs on undeclared usage, because the rule
 * library is incomplete. Phase 4's marketplace gate promotes these
 * to errors when AST-level analysis lands.
 */
export function checkCapabilityHonesty(
  manifest: Manifest,
  bundleText: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const declared = manifest.capabilities;

  for (const rule of HONESTY_RULES) {
    // Reset regex state — these are global flag.
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(bundleText)) !== null) {
      const needed = rule.expectedScope(match);
      if (!capabilityCovered(declared, needed)) {
        issues.push({
          layer: "honesty",
          severity: "warning",
          message:
            `bundle uses pattern matching "${rule.description}" ` +
            `but capability "${needed}" is not declared in the manifest`,
          path: needed,
        });
      }
    }
  }

  return issues;
}

/**
 * Full manifest validation: schema + (optional) capability honesty.
 *
 * Pass `bundleText` to enable the honesty check. The fetcher (C3)
 * only returns the bundle URL, not the bundle body — the install
 * pipeline (C5) fetches the bundle and threads it through here.
 */
export function validateManifestFull(
  raw: unknown,
  bundleText?: string,
): ManifestValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const schemaResult = schemaValidate(raw);
  if (!schemaResult.valid) {
    for (const e of schemaResult.errors) errors.push(fromSchemaError(e));
    // Don't proceed to honesty if the schema itself is wrong — the
    // manifest may be partial.
    return { ok: false, errors, warnings };
  }

  const manifest = raw as Manifest;

  if (bundleText) {
    for (const issue of checkCapabilityHonesty(manifest, bundleText)) {
      // Honesty is a warning in v1; promotes to error in Phase 4.
      warnings.push(issue);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

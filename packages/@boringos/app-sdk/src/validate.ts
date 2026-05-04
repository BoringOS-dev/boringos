// SPDX-License-Identifier: MIT
//
// Manifest validation — wraps Ajv around the JSON Schema in
// schemas/manifest.schema.json. Used by:
//   - The install pipeline (TASK-C5) before any install begins
//   - The marketplace publish flow (Phase 4) to gate submissions
//   - The connector / app scaffolders for local dev validation
//   - Test harnesses that want to assert manifest correctness

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import _Ajv2020 from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";

import type { Manifest, ConnectorManifest, AppManifest } from "./manifest.js";

/* ── ESM/CJS interop shims (Ajv 8.x ships CJS) ─────────────────────── */

type Ajv2020Ctor = new (opts?: { allErrors?: boolean; strict?: boolean }) => {
  compile(schema: unknown): AjvValidateFn;
};

interface AjvErrorObject {
  instancePath: string;
  message?: string;
  keyword: string;
}

type AjvValidateFn = ((data: unknown) => boolean) & {
  errors?: AjvErrorObject[] | null;
};

const Ajv2020 = ((_Ajv2020 as unknown as { default?: Ajv2020Ctor }).default ??
  (_Ajv2020 as unknown as Ajv2020Ctor)) as Ajv2020Ctor;

const addFormats = ((_addFormats as unknown as { default?: (a: unknown) => void }).default ??
  (_addFormats as unknown as (a: unknown) => void)) as (a: unknown) => void;

/* ── Schema loading ─────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves to the JSON Schema file at package_root/schemas/manifest.schema.json
 * regardless of whether the SDK is being consumed from source or from a
 * published tarball — both layouts have schemas/ at the package root.
 */
const SCHEMA_PATH = join(__dirname, "..", "schemas", "manifest.schema.json");

const SCHEMA: Record<string, unknown> = JSON.parse(
  readFileSync(SCHEMA_PATH, "utf-8")
);

/* ── Validator ──────────────────────────────────────────────────────── */

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

const validateFn: AjvValidateFn = ajv.compile(SCHEMA);

/* ── Public API ─────────────────────────────────────────────────────── */

export interface ValidationError {
  /** JSON Pointer path to the offending location (e.g. "/publisher/name"). */
  path: string;
  /** Human-readable error description. */
  message: string;
  /** The Ajv keyword that failed (e.g. "required", "type", "const"). */
  keyword?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate an unknown value against the BoringOS manifest schema.
 * Returns a structured result; never throws.
 *
 * @example
 * ```ts
 * import { validateManifest } from "@boringos/app-sdk";
 * const raw = JSON.parse(fs.readFileSync("boringos.json", "utf-8"));
 * const result = validateManifest(raw);
 * if (!result.valid) {
 *   for (const err of result.errors) {
 *     console.error(`${err.path}: ${err.message}`);
 *   }
 * }
 * ```
 */
export function validateManifest(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };

  return {
    valid: false,
    errors: (validateFn.errors ?? []).map((e: AjvErrorObject) => ({
      path: e.instancePath || "/",
      message: e.message ?? "validation error",
      keyword: e.keyword,
    })),
  };
}

/**
 * Type guard: returns true if the value is a valid Manifest.
 * Useful for narrowing in TypeScript code.
 */
export function isValidManifest(value: unknown): value is Manifest {
  return validateManifest(value).valid;
}

/**
 * Type guard for the connector variant specifically.
 */
export function isConnectorManifest(value: unknown): value is ConnectorManifest {
  if (!isValidManifest(value)) return false;
  return (value as Manifest).kind === "connector";
}

/**
 * Type guard for the app variant specifically.
 */
export function isAppManifest(value: unknown): value is AppManifest {
  if (!isValidManifest(value)) return false;
  return (value as Manifest).kind === "app";
}

/* ── Schema export ──────────────────────────────────────────────────── */

/**
 * The compiled JSON Schema object. Exposed for tools that want to do
 * their own validation, generate documentation, or render the schema.
 */
export const MANIFEST_SCHEMA: Readonly<Record<string, unknown>> = SCHEMA;

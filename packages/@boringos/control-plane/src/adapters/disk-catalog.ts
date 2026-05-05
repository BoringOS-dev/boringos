// SPDX-License-Identifier: BUSL-1.1
//
// K8 — load DEFAULT_APPS_CATALOG entries from disk.
//
// Walks the framework's apps directory at boot, reads each
// `boringos.json`, validates it, loads the bundle text, computes a
// SHA-256 manifest hash, and returns DefaultAppEntry[].
//
// Connectors (`@boringos/connector-*`) are NOT default apps; this
// loader skips manifests with kind="connector" so the catalog stays
// app-only.

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { AppManifest, Manifest } from "@boringos/app-sdk";

import type { DefaultAppEntry } from "../default-apps.js";
import { validateManifestFull } from "../validator.js";

export interface LoadCatalogOptions {
  /**
   * If true, malformed manifests are skipped (with a warning entry in
   * the result). If false (default), they throw — boot decides what
   * to do.
   */
  skipMalformed?: boolean;
}

export interface CatalogLoaderEntryError {
  appDir: string;
  message: string;
}

export interface LoadCatalogResult {
  entries: DefaultAppEntry[];
  errors: CatalogLoaderEntryError[];
}

/**
 * Read every directory in `appsDir` that contains a `boringos.json`,
 * validate the manifest, attach the compiled bundle text, and return
 * a `DefaultAppEntry` per app.
 *
 * Connector manifests are skipped (only kind="app" is included).
 *
 * Throws by default on the first malformed manifest. Pass
 * `{ skipMalformed: true }` to collect them in `result.errors` instead.
 */
export function loadCatalogFromDisk(
  appsDir: string,
  options: LoadCatalogOptions = {},
): LoadCatalogResult {
  const root = isAbsolute(appsDir) ? appsDir : resolve(appsDir);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new CatalogLoaderError(`Apps directory does not exist: ${root}`);
  }

  const entries: DefaultAppEntry[] = [];
  const errors: CatalogLoaderEntryError[] = [];

  for (const child of readdirSync(root).sort()) {
    const appDir = join(root, child);
    if (!statSync(appDir).isDirectory()) continue;

    const manifestPath = join(appDir, "boringos.json");
    if (!existsSync(manifestPath)) continue;

    let loaded: DefaultAppEntry | null;
    try {
      loaded = loadEntry(appDir, manifestPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (options.skipMalformed) {
        errors.push({ appDir, message });
        continue;
      }
      throw new CatalogLoaderError(
        `Failed to load app at ${appDir}: ${message}`,
        { cause: e },
      );
    }
    if (loaded) entries.push(loaded);
  }

  return { entries, errors };
}

function loadEntry(appDir: string, manifestPath: string): DefaultAppEntry | null {
  const manifestText = readFileSync(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (e) {
    throw new Error(
      `Manifest is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // Resolve bundle entry up front so we can pass the bundle text to
  // the validator's capability-honesty check.
  const bundlePath = resolveBundleEntry(parsed, appDir);
  const bundleText =
    bundlePath && existsSync(bundlePath) ? readFileSync(bundlePath, "utf8") : "";

  const validation = validateManifestFull(parsed, bundleText);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(
      `Manifest validation failed${first ? `: ${first.message}` : ""}`,
    );
  }

  const manifest = parsed as Manifest;

  // K8 spec: skip connectors — they're not default apps. Silent skip
  // (return null) rather than an error: a connector under apps/ is
  // legal but not a catalog entry.
  if (manifest.kind === "connector") {
    return null;
  }

  const manifestHash = createHash("sha256").update(manifestText).digest("hex");

  return {
    id: manifest.id,
    manifest,
    bundleText,
    manifestHash,
  };
}

function resolveBundleEntry(parsed: unknown, appDir: string): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as { kind?: unknown; ui?: unknown; entry?: unknown };
  if (m.kind === "app") {
    const ui = m.ui;
    if (ui && typeof ui === "object") {
      const entry = (ui as { entry?: unknown }).entry;
      if (typeof entry === "string") {
        return resolveRelative(entry, appDir);
      }
    }
    return null;
  }
  if (m.kind === "connector" && typeof m.entry === "string") {
    return resolveRelative(m.entry, appDir);
  }
  return null;
}

function resolveRelative(p: string, base: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}

export class CatalogLoaderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogLoaderError";
  }
}

/**
 * Convenience helper for `installDefaultApps` consumers that want a
 * plain catalog array (no errors). Throws on the first malformed
 * manifest. Equivalent to `loadCatalogFromDisk(dir).entries` with
 * strict mode.
 */
export function loadCatalogStrict(appsDir: string): DefaultAppEntry[] {
  return loadCatalogFromDisk(appsDir, { skipMalformed: false }).entries;
}

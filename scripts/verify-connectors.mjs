#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// verify-connectors.mjs — CI verification script (TASK-D4).
//
// Walks every packages/@boringos/connector-*/ that has a boringos.json
// and verifies:
//
//   1. Manifest validates against the @boringos/app-sdk JSON Schema
//   2. Every file referenced from the manifest (event/action schemas,
//      skill markdown) actually exists on disk
//   3. The manifest's declarations match the built runtime
//      ConnectorDefinition exactly:
//      - event types
//      - action names
//      - OAuth scopes
//      - action count (per `actions:expose:N` capability)
//   4. Network honesty: every https:// host appearing in the manifest's
//      auth URLs has a matching `network:outbound:<host>` capability
//
// Exits 0 on success, 1 on any verification failure. Designed to run on
// every PR touching packages/@boringos/connector-*.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages", "@boringos");

/* ── Logging ─────────────────────────────────────────────────────────── */

const C_RED = "\x1b[31m";
const C_GREEN = "\x1b[32m";
const C_YELLOW = "\x1b[33m";
const C_BOLD = "\x1b[1m";
const C_RESET = "\x1b[0m";

const tty = process.stdout.isTTY;
const fmt = (color, s) => (tty ? color + s + C_RESET : s);
const ok = (s) => console.log(fmt(C_GREEN, "  ✓ ") + s);
const fail = (s) => console.log(fmt(C_RED, "  ✗ ") + s);
const warn = (s) => console.log(fmt(C_YELLOW, "  ⚠ ") + s);

/* ── Discovery ───────────────────────────────────────────────────────── */

function findConnectorPackages() {
  if (!existsSync(PACKAGES_DIR)) return [];
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("connector-"))
    .map((d) => join(PACKAGES_DIR, d.name))
    .filter((p) => existsSync(join(p, "boringos.json")));
}

/* ── Validators ──────────────────────────────────────────────────────── */

async function loadValidator() {
  const sdkPath = join(REPO_ROOT, "packages/@boringos/app-sdk/dist/index.js");
  if (!existsSync(sdkPath)) {
    throw new Error(
      `@boringos/app-sdk dist not found at ${sdkPath}. Run "pnpm -F @boringos/app-sdk build" first.`
    );
  }
  return import(sdkPath);
}

function readManifest(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, "boringos.json"), "utf-8"));
}

function checkSchema(manifest, validator) {
  const result = validator.validateManifest(manifest);
  if (!result.valid) {
    for (const e of result.errors) {
      fail(`schema: ${e.path || "/"}: ${e.message}`);
    }
    return false;
  }
  ok(`schema: manifest validates against @boringos/app-sdk schema`);
  return true;
}

function checkReferencedFiles(manifest, pkgDir) {
  const refs = [
    ...manifest.events.map((e) => ["event schema", e.schema]),
    ...manifest.actions.flatMap((a) => [
      ["action input", a.inputSchema],
      ["action output", a.outputSchema],
    ]),
    ...(manifest.skills ?? []).map((s) => ["skill", s]),
  ].filter(([, p]) => p);

  let allExist = true;
  for (const [kind, p] of refs) {
    if (!existsSync(join(pkgDir, p))) {
      fail(`referenced file missing: ${p} (${kind})`);
      allExist = false;
    }
  }
  if (allExist) {
    ok(`referenced files: all ${refs.length} present`);
  }
  return allExist;
}

async function checkRuntimeCrossCheck(manifest, pkgDir) {
  const distEntry = join(pkgDir, manifest.entry);
  if (!existsSync(distEntry)) {
    fail(
      `runtime: manifest.entry "${manifest.entry}" does not exist at ${distEntry}. Run the package's build first.`
    );
    return false;
  }

  // Connector packages export a factory function. Find it dynamically:
  // expected named export matches the connector kind (slack, google, etc.)
  // OR a default export.
  const mod = await import(distEntry);
  let runtime;
  const factoryName = manifest.id;
  if (typeof mod[factoryName] === "function") {
    // Call factory with empty config; some configs are required at runtime
    // but we only need the static fields (kind, events, actions, oauth)
    // which factories produce regardless of config validity.
    try {
      runtime = mod[factoryName]({ signingSecret: "verify", clientId: "x", clientSecret: "y" });
    } catch (e) {
      fail(`runtime: factory \`${factoryName}\` threw on call: ${e.message}`);
      return false;
    }
  } else if (mod.default && typeof mod.default === "object") {
    runtime = mod.default;
  } else {
    fail(
      `runtime: ${distEntry} does not export a factory named "${factoryName}" or a default ConnectorDefinition`
    );
    return false;
  }

  let allOk = true;

  // Event types
  const mEvents = [...manifest.events.map((e) => e.type)].sort();
  const rEvents = [...(runtime.events ?? []).map((e) => e.type)].sort();
  if (JSON.stringify(mEvents) !== JSON.stringify(rEvents)) {
    fail(`events: manifest=${JSON.stringify(mEvents)} runtime=${JSON.stringify(rEvents)}`);
    allOk = false;
  } else {
    ok(`events: ${mEvents.length} types match`);
  }

  // Action names
  const mActions = [...manifest.actions.map((a) => a.name)].sort();
  const rActions = [...(runtime.actions ?? []).map((a) => a.name)].sort();
  if (JSON.stringify(mActions) !== JSON.stringify(rActions)) {
    fail(`actions: manifest=${JSON.stringify(mActions)} runtime=${JSON.stringify(rActions)}`);
    allOk = false;
  } else {
    ok(`actions: ${mActions.length} names match`);
  }

  // OAuth scopes (only if both declare oauth)
  if (manifest.auth?.type === "oauth2" && runtime.oauth) {
    const mScopes = [...manifest.auth.scopes].sort();
    const rScopes = [...runtime.oauth.scopes].sort();
    if (JSON.stringify(mScopes) !== JSON.stringify(rScopes)) {
      fail(
        `oauth scopes diverge\n      manifest: ${JSON.stringify(mScopes)}\n      runtime:  ${JSON.stringify(rScopes)}`
      );
      allOk = false;
    } else {
      ok(`oauth scopes: ${mScopes.length} scopes match`);
    }
  }

  // Capability: actions:expose:N matches actual count
  const declared = manifest.capabilities
    .filter((c) => c.startsWith("actions:expose:"))
    .map((c) => Number(c.split(":")[2]))[0];
  if (declared !== undefined) {
    if (declared !== runtime.actions.length) {
      fail(
        `actions:expose: declared=${declared} but actual action count=${runtime.actions.length}`
      );
      allOk = false;
    } else {
      ok(`actions:expose:${declared} matches actual action count`);
    }
  }

  return allOk;
}

function checkNetworkHonesty(manifest) {
  const declared = new Set(
    manifest.capabilities
      .filter((c) => c.startsWith("network:outbound:"))
      .map((c) => c.split(":")[2])
  );

  // Only scan fields that represent actual outbound calls. Publisher
  // metadata, schema $id URLs, and the IDE-hint $schema URL are not
  // outbound — they're identifiers and metadata.
  const outboundUrls = [];
  if (manifest.auth?.type === "oauth2") {
    if (manifest.auth.authorizationUrl) outboundUrls.push(manifest.auth.authorizationUrl);
    if (manifest.auth.tokenUrl) outboundUrls.push(manifest.auth.tokenUrl);
  }

  const found = new Set();
  for (const u of outboundUrls) {
    try { found.add(new URL(u).hostname); } catch { /* skip malformed */ }
  }

  // A host is "covered" if it equals a declared domain or is a subdomain of one.
  const isCovered = (host) => {
    for (const d of declared) {
      if (host === d || host.endsWith("." + d)) return true;
    }
    return false;
  };

  const orphanHosts = [...found].filter((h) => !isCovered(h));

  if (orphanHosts.length > 0) {
    fail(
      `network honesty: outbound hosts referenced in auth but not declared: ${JSON.stringify(orphanHosts)}\n` +
      `      declared network:outbound:* capabilities: ${JSON.stringify([...declared])}`
    );
    return false;
  }
  ok(`network honesty: all ${found.size} auth host(s) covered by declared capabilities`);
  return true;
}

/* ── Main ────────────────────────────────────────────────────────────── */

async function main() {
  const validator = await loadValidator();

  const pkgs = findConnectorPackages();
  if (pkgs.length === 0) {
    console.log("No connector packages with boringos.json found. Nothing to verify.");
    process.exit(0);
  }

  console.log(fmt(C_BOLD, `Verifying ${pkgs.length} connector package(s)\n`));

  let totalOk = 0;
  let totalFail = 0;

  for (const pkgDir of pkgs) {
    const name = pkgDir.split("/").slice(-2).join("/");
    console.log(fmt(C_BOLD, `▸ ${name}`));

    let manifest;
    try {
      manifest = readManifest(pkgDir);
    } catch (e) {
      fail(`could not read boringos.json: ${e.message}`);
      totalFail++;
      console.log("");
      continue;
    }

    let pkgOk = true;
    pkgOk = checkSchema(manifest, validator) && pkgOk;
    pkgOk = checkReferencedFiles(manifest, pkgDir) && pkgOk;
    pkgOk = (await checkRuntimeCrossCheck(manifest, pkgDir)) && pkgOk;
    pkgOk = checkNetworkHonesty(manifest) && pkgOk;

    if (pkgOk) totalOk++;
    else totalFail++;
    console.log("");
  }

  const ttl = pkgs.length;
  console.log(fmt(C_BOLD, `Summary: ${totalOk}/${ttl} passed, ${totalFail}/${ttl} failed`));
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(fmt(C_RED, "verify-connectors crashed:"));
  console.error(e);
  process.exit(2);
});

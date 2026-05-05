// SPDX-License-Identifier: BUSL-1.1
//
// Manifest fetcher — resolves any GitHub URL the user pastes into the
// shell's "Install from URL" flow into a fetched manifest + bundle URL
// + content hash. Doesn't validate (that's C4) and doesn't install
// (that's C5) — just produces the artifact next steps consume.
//
// Accepted URL forms:
//   github.com/org/repo                        → latest tagged release
//   github.com/org/repo@v1.2.3                 → specific tag
//   github.com/org/repo#branchname             → tip of a branch
//   https:// or http:// prefix is optional
//
// For tagged releases, we fetch the tag's release artifact metadata
// from the GitHub API to discover the bundle URL. For branch tips we
// derive both manifest + bundle URLs from raw.githubusercontent.com.

import { createHash } from "node:crypto";

import type { Manifest } from "@boringos/app-sdk";

/* ── Parsing ────────────────────────────────────────────────────────── */

export interface ParsedRepoUrl {
  org: string;
  repo: string;
  /** "version" | "branch" | "latest" */
  refKind: "version" | "branch" | "latest";
  /** Version tag (without leading 'v') or branch name; undefined when refKind=latest. */
  ref?: string;
}

const URL_PATTERN = /^(?:https?:\/\/)?github\.com\/([^/\s@#]+)\/([^/\s@#]+?)(?:\.git)?(?:[/\s]*)$/;
const URL_PATTERN_AT_VERSION = /^(?:https?:\/\/)?github\.com\/([^/\s@#]+)\/([^/\s@#]+?)@v?([^\s]+)$/;
const URL_PATTERN_AT_BRANCH = /^(?:https?:\/\/)?github\.com\/([^/\s@#]+)\/([^/\s@#]+?)#([^\s]+)$/;

export function parseRepoUrl(input: string): ParsedRepoUrl | null {
  const trimmed = input.trim();
  let m = trimmed.match(URL_PATTERN_AT_VERSION);
  if (m) return { org: m[1]!, repo: m[2]!, refKind: "version", ref: m[3]! };

  m = trimmed.match(URL_PATTERN_AT_BRANCH);
  if (m) return { org: m[1]!, repo: m[2]!, refKind: "branch", ref: m[3]! };

  m = trimmed.match(URL_PATTERN);
  if (m) return { org: m[1]!, repo: m[2]!, refKind: "latest" };

  return null;
}

/* ── Fetcher ────────────────────────────────────────────────────────── */

export interface FetchedManifest {
  /** Parsed manifest JSON. Validation happens in C4. */
  manifest: Manifest;
  /** URL where the install pipeline will fetch the bundle (dist/) from. */
  bundleUrl: string;
  /** SHA-256 of the manifest body — pinned on the install record. */
  hash: string;
  /** Resolved git ref (tag or branch) the manifest was fetched from. */
  resolvedRef: string;
}

export interface FetcherOptions {
  /**
   * Optional GitHub PAT for private repos. Sent as `Authorization:
   * Bearer <token>` for both API calls and raw.githubusercontent.com
   * fetches (raw URLs accept token via the same header).
   */
  githubToken?: string;
  /**
   * fetch implementation — defaulted to globalThis.fetch. Tests inject.
   */
  fetchImpl?: typeof fetch;
}

function authHeaders(token: string | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function resolveLatestTag(
  parsed: ParsedRepoUrl,
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<string> {
  const url = `https://api.github.com/repos/${parsed.org}/${parsed.repo}/releases/latest`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders(token) },
  });
  if (!res.ok) {
    throw new Error(
      `Could not resolve latest release for ${parsed.org}/${parsed.repo} (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) {
    throw new Error(
      `Latest release for ${parsed.org}/${parsed.repo} has no tag_name.`,
    );
  }
  return data.tag_name;
}

function rawFileUrl(parsed: ParsedRepoUrl, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${parsed.org}/${parsed.repo}/${ref}/${path}`;
}

/**
 * Fetch the boringos.json manifest at the requested ref.
 *
 * Returns the parsed manifest plus a `bundleUrl` pointing at where the
 * install pipeline will fetch the compiled bundle from, and a SHA-256
 * hash of the manifest body for pinning on the install record.
 *
 * Validation is C4's job — this fetcher returns the parsed JSON as
 * `Manifest` without checking it against the schema.
 */
export async function fetchManifest(
  input: string,
  options: FetcherOptions = {},
): Promise<FetchedManifest> {
  const parsed = parseRepoUrl(input);
  if (!parsed) {
    throw new Error(
      `Not a recognized GitHub URL: "${input}". ` +
        `Accepted forms: github.com/org/repo, .../repo@v1.2.3, .../repo#branch.`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  let resolvedRef: string;
  if (parsed.refKind === "version") {
    resolvedRef = parsed.ref!.startsWith("v") ? parsed.ref! : `v${parsed.ref!}`;
  } else if (parsed.refKind === "branch") {
    resolvedRef = parsed.ref!;
  } else {
    resolvedRef = await resolveLatestTag(parsed, fetchImpl, options.githubToken);
  }

  const manifestUrl = rawFileUrl(parsed, resolvedRef, "boringos.json");
  const res = await fetchImpl(manifestUrl, { headers: authHeaders(options.githubToken) });
  if (!res.ok) {
    throw new Error(
      `Could not fetch boringos.json from ${parsed.org}/${parsed.repo}@${resolvedRef} ` +
        `(HTTP ${res.status}). The repo may be private — pass a GitHub token, or check the ref.`,
    );
  }

  const body = await res.text();
  const hash = createHash("sha256").update(body).digest("hex");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(body) as Manifest;
  } catch (e) {
    throw new Error(
      `boringos.json at ${parsed.org}/${parsed.repo}@${resolvedRef} is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // Bundle URL: the manifest's `entry` field is a relative path to the
  // compiled JS bundle, conventionally inside dist/. Treat the entry's
  // dirname as the bundle root so the install pipeline can fetch
  // adjacent files (schemas/, skills/) by path.
  const entry =
    "entry" in manifest && typeof manifest.entry === "string"
      ? manifest.entry
      : "dist/index.js";
  const bundleUrl = rawFileUrl(parsed, resolvedRef, entry);

  return { manifest, bundleUrl, hash, resolvedRef };
}

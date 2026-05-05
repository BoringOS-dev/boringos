/**
 * Manifest fetcher (TASK-C3)
 *
 * Verifies URL parsing, ref resolution (latest tag / explicit version /
 * branch), JSON fetching, hashing, error paths.
 */
import { describe, it, expect } from "vitest";
import { parseRepoUrl, fetchManifest } from "@boringos/control-plane";
import type { ConnectorManifest } from "@boringos/app-sdk";

// ── parseRepoUrl ────────────────────────────────────────────────────────

describe("parseRepoUrl", () => {
  it("recognizes a bare repo URL as 'latest'", () => {
    expect(parseRepoUrl("github.com/acme/stripe")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "latest",
    });
  });

  it("recognizes https:// prefix", () => {
    expect(parseRepoUrl("https://github.com/acme/stripe")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "latest",
    });
  });

  it("strips .git suffix", () => {
    expect(parseRepoUrl("github.com/acme/stripe.git")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "latest",
    });
  });

  it("recognizes @v1.2.3 version pin", () => {
    expect(parseRepoUrl("github.com/acme/stripe@v1.2.3")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "version",
      ref: "1.2.3",
    });
  });

  it("recognizes @1.2.3 (without v prefix)", () => {
    expect(parseRepoUrl("github.com/acme/stripe@1.2.3")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "version",
      ref: "1.2.3",
    });
  });

  it("recognizes #branch pin", () => {
    expect(parseRepoUrl("github.com/acme/stripe#feat/oauth")).toEqual({
      org: "acme",
      repo: "stripe",
      refKind: "branch",
      ref: "feat/oauth",
    });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseRepoUrl("gitlab.com/acme/stripe")).toBeNull();
    expect(parseRepoUrl("not a url")).toBeNull();
    expect(parseRepoUrl("")).toBeNull();
  });
});

// ── fetchManifest — happy paths ─────────────────────────────────────────

const SLACK_MANIFEST: ConnectorManifest = {
  kind: "connector",
  id: "slack",
  version: "1.0.0",
  name: "Slack",
  description: "…",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "MIT",
  entry: "dist/index.js",
  auth: { type: "oauth2", provider: "slack", scopes: [] },
  events: [],
  actions: [],
  capabilities: [],
};

function makeFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const handler = handlers[url];
    if (!handler) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return handler();
  }) as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("fetchManifest — happy paths", () => {
  it("fetches a branch ref directly from raw.githubusercontent", async () => {
    const fetchImpl = makeFetch({
      "https://raw.githubusercontent.com/acme/stripe/main/boringos.json": () =>
        jsonResponse(SLACK_MANIFEST),
    });

    const result = await fetchManifest("github.com/acme/stripe#main", { fetchImpl });

    expect(result.manifest.kind).toBe("connector");
    expect(result.resolvedRef).toBe("main");
    expect(result.bundleUrl).toBe(
      "https://raw.githubusercontent.com/acme/stripe/main/dist/index.js",
    );
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fetches an explicit version ref with v-prefix normalization", async () => {
    const fetchImpl = makeFetch({
      "https://raw.githubusercontent.com/acme/stripe/v1.2.3/boringos.json": () =>
        jsonResponse(SLACK_MANIFEST),
    });

    const result = await fetchManifest("github.com/acme/stripe@1.2.3", { fetchImpl });

    expect(result.resolvedRef).toBe("v1.2.3");
  });

  it("resolves 'latest' via the GitHub releases API", async () => {
    const fetchImpl = makeFetch({
      "https://api.github.com/repos/acme/stripe/releases/latest": () =>
        jsonResponse({ tag_name: "v2.5.1" }),
      "https://raw.githubusercontent.com/acme/stripe/v2.5.1/boringos.json": () =>
        jsonResponse(SLACK_MANIFEST),
    });

    const result = await fetchManifest("github.com/acme/stripe", { fetchImpl });

    expect(result.resolvedRef).toBe("v2.5.1");
    expect(result.manifest.id).toBe("slack");
  });

  it("hash is deterministic for identical bodies", async () => {
    const fetchImpl = makeFetch({
      "https://raw.githubusercontent.com/acme/stripe/main/boringos.json": () =>
        jsonResponse(SLACK_MANIFEST),
    });

    const a = await fetchManifest("github.com/acme/stripe#main", { fetchImpl });
    const b = await fetchManifest("github.com/acme/stripe#main", { fetchImpl });
    expect(a.hash).toBe(b.hash);
  });
});

// ── fetchManifest — error paths ─────────────────────────────────────────

describe("fetchManifest — error paths", () => {
  it("throws on non-GitHub URL", async () => {
    await expect(fetchManifest("not a url")).rejects.toThrow(/Not a recognized GitHub URL/);
  });

  it("throws when manifest fetch returns non-2xx", async () => {
    const fetchImpl = makeFetch({
      "https://raw.githubusercontent.com/acme/stripe/main/boringos.json": () =>
        new Response("not found", { status: 404 }),
    });
    await expect(
      fetchManifest("github.com/acme/stripe#main", { fetchImpl }),
    ).rejects.toThrow(/Could not fetch boringos\.json/);
  });

  it("throws when manifest body is not JSON", async () => {
    const fetchImpl = makeFetch({
      "https://raw.githubusercontent.com/acme/stripe/main/boringos.json": () =>
        new Response("this is not JSON", { status: 200 }),
    });
    await expect(
      fetchManifest("github.com/acme/stripe#main", { fetchImpl }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when latest release has no tag_name", async () => {
    const fetchImpl = makeFetch({
      "https://api.github.com/repos/acme/stripe/releases/latest": () =>
        jsonResponse({}),
    });
    await expect(
      fetchManifest("github.com/acme/stripe", { fetchImpl }),
    ).rejects.toThrow(/no tag_name/);
  });
});

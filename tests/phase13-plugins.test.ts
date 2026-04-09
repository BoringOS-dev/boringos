/**
 * Phase 13 Smoke Tests — Plugin System
 */
import { describe, it, expect } from "vitest";

describe("plugin system", () => {
  it("plugin registry registers and lists plugins", async () => {
    const { createPluginRegistry, githubPlugin } = await import("@boringos/core");
    const registry = createPluginRegistry();
    registry.register(githubPlugin);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("github")?.name).toBe("github");
    expect(registry.get("github")?.jobs).toHaveLength(1);
    expect(registry.get("github")?.webhooks).toHaveLength(2);
  });

  it("github plugin webhook handles issue-created", async () => {
    const { githubPlugin } = await import("@boringos/core");
    const webhook = githubPlugin.webhooks?.find((w) => w.event === "issue-created");
    expect(webhook).toBeTruthy();

    const result = await webhook!.handler({
      method: "POST",
      headers: {},
      body: { action: "opened", issue: { title: "Bug report", number: 42 } },
      tenantId: "t1",
      config: {},
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).action).toBe("task_created");
    expect((result.body as Record<string, unknown>).title).toBe("Bug report");
  });

  it("BoringOS boots with plugin system and lists plugins via admin API", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-plugin-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5578 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "s", adminKey: "plugin-key" },
    });
    const server = await app.listen(0);

    try {
      // List plugins — github is built-in
      const res = await fetch(`${server.url}/api/admin/plugins`, {
        headers: { "X-API-Key": "plugin-key", "X-Tenant-Id": "any" },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { plugins: Array<{ name: string }> };
      expect(body.plugins.some((p) => p.name === "github")).toBe(true);
    } finally {
      await server.close();
    }
  }, 30000);
});

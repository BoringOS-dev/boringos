/**
 * K11 — admin uninstall endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { createAppsAdminRoutes } from "@boringos/core";
import {
  createAppRouteRegistry,
  createKernelInstallContext,
} from "@boringos/control-plane";
import type { AppManifest } from "@boringos/app-sdk";
import { defineApp } from "@boringos/app-sdk";
import { InstallRuntime } from "@boringos/shell/runtime/install-runtime.js";

let dataDir: string;
let conn: { db: any; close(): Promise<void> };
let tenantId: string;

beforeAll(async () => {
  const { createDatabase, createMigrationManager } = await import("@boringos/db");
  dataDir = mkdtempSync(join(tmpdir(), "bos-k11-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5590,
  });
  await createMigrationManager(conn.db).apply();
  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K11', 'k11-test') RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const baseManifest: AppManifest = {
  kind: "app",
  id: "k11-app",
  version: "1.0.0",
  name: "K11 App",
  description: "K11 uninstall endpoint test",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [],
  ui: { entry: "dist/ui.js" },
  capabilities: [],
};

function buildHttpApp(role: "admin" | "member" = "admin", hardDelete = false) {
  const coreApp = new Hono();
  const routeRegistry = createAppRouteRegistry();
  routeRegistry.attachTo(coreApp);
  const shellRuntime = new InstallRuntime();
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const kernel = createKernelInstallContext({
    db: conn.db,
    routeRegistry,
    slotRuntime: {
      installApp: (a) => shellRuntime.installApp(a),
      uninstallApp: (id) => shellRuntime.uninstallApp(id),
    },
    events: { emit: (type, payload) => { events.push({ type, payload }); } },
    hardDeleteAppData: hardDelete
      ? async (_t, appId) => {
          await conn.db.execute(sql`DELETE FROM tenant_app_links WHERE target_app_id = ${appId}`);
        }
      : undefined,
  });

  const appsAdmin = createAppsAdminRoutes({
    db: conn.db,
    kernelContext: kernel,
    resolveDefinition: (m) => defineApp({ id: m.id }),
    auth: {
      resolve: () => ({ tenantId, userId: "u-1", role }),
    },
  });

  const httpApp = new Hono();
  httpApp.route("/api/admin/apps", appsAdmin);
  return { httpApp, shellRuntime, events };
}

async function installViaApi(httpApp: Hono, manifest: AppManifest) {
  const res = await httpApp.fetch(
    new Request("http://t/api/admin/apps/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest }),
    }),
  );
  expect(res.status).toBe(200);
}

describe("createAppsAdminRoutes — DELETE /:appId", () => {
  it("soft uninstall returns 200 + UninstallResult", async () => {
    const { httpApp, shellRuntime } = buildHttpApp();
    await installViaApi(httpApp, { ...baseManifest, id: "k11-soft" });

    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/k11-soft?mode=soft", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uninstalled: boolean; mode: string };
    expect(body.uninstalled).toBe(true);
    expect(body.mode).toBe("soft");
    expect(shellRuntime.isInstalled("k11-soft")).toBe(false);
  });

  it("cascade is reported in the body when force=false and dependents exist", async () => {
    const { httpApp } = buildHttpApp();
    await installViaApi(httpApp, { ...baseManifest, id: "k11-target" });

    // Plant a dependency: another app declared `entities.k11-target:read`
    // (cross-app capability). The uninstall should warn but not proceed.
    await conn.db.execute(sql`
      INSERT INTO tenant_app_links (tenant_id, source_app_id, target_app_id, capability)
      VALUES (${tenantId}, 'other-app', 'k11-target', 'entities.k11-target:read')
      ON CONFLICT DO NOTHING
    `);

    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/k11-target?mode=soft", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uninstalled: boolean; cascade: any[] };
    expect(body.uninstalled).toBe(false);
    expect(body.cascade).toHaveLength(1);
    expect(body.cascade[0]?.sourceAppId).toBe("other-app");

    // Now retry with force=true → succeeds.
    const forced = await httpApp.fetch(
      new Request("http://t/api/admin/apps/k11-target?mode=soft&force=true", {
        method: "DELETE",
      }),
    );
    expect(forced.status).toBe(200);
    const forcedBody = (await forced.json()) as { uninstalled: boolean };
    expect(forcedBody.uninstalled).toBe(true);
  });

  it("hard uninstall succeeds when hardDeleteAppData is wired", async () => {
    const { httpApp } = buildHttpApp("admin", true);
    await installViaApi(httpApp, { ...baseManifest, id: "k11-hard" });

    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/k11-hard?mode=hard&force=true", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uninstalled: boolean; mode: string };
    expect(body.uninstalled).toBe(true);
    expect(body.mode).toBe("hard");

    // Hard mode also deletes the install record.
    const rows = (await conn.db.execute(sql`
      SELECT app_id FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'k11-hard'
    `)) as Array<{ app_id: string }>;
    expect(rows).toEqual([]);
  });

  it("hard uninstall without hardDeleteAppData wired → 500", async () => {
    const { httpApp } = buildHttpApp("admin", false);
    await installViaApi(httpApp, { ...baseManifest, id: "k11-hard-fail" });

    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/k11-hard-fail?mode=hard&force=true", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(500);
  });

  it("uninstall of an unknown app returns 404", async () => {
    const { httpApp } = buildHttpApp();
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/never-installed-k11?mode=soft", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("non-admin gets 403", async () => {
    const { httpApp } = buildHttpApp("member");
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/anything?mode=soft", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("invalid mode returns 400", async () => {
    const { httpApp } = buildHttpApp();
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/anything?mode=banana", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(400);
  });
});

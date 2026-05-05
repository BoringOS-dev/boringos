/**
 * K10 — admin install endpoint.
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
  dataDir = mkdtempSync(join(tmpdir(), "bos-k10-"));
  conn = await createDatabase({
    embedded: true,
    dataDir: join(dataDir, "pg"),
    port: 5591,
  });
  await createMigrationManager(conn.db).apply();
  const inserted = await conn.db.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('K10', 'k10-test') RETURNING id
  `);
  tenantId = (inserted as any[])[0].id as string;
}, 120_000);

afterAll(async () => {
  await conn?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const validManifest: AppManifest = {
  kind: "app",
  id: "k10-app",
  version: "1.0.0",
  name: "K10 App",
  description: "K10 endpoint test",
  publisher: { name: "BoringOS", verified: true },
  minRuntime: "1.0.0",
  license: "BUSL-1.1",
  hosting: "in-process",
  entityTypes: [],
  ui: { entry: "dist/ui.js" },
  capabilities: ["slots:nav"],
};

function buildHttpApp(role: "admin" | "member" | "no-tenant" = "admin") {
  const coreApp = new Hono();
  const routeRegistry = createAppRouteRegistry();
  routeRegistry.attachTo(coreApp);
  const shellRuntime = new InstallRuntime();
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const kernel = createKernelInstallContext({
    db: conn.db,
    routeRegistry,
    slotRuntime: {
      installApp: (a) => shellRuntime.installApp(a),
      uninstallApp: (id) => shellRuntime.uninstallApp(id),
    },
    events: { emit: (type, payload) => { events.push({ type, payload }); } },
  });

  const appsAdmin = createAppsAdminRoutes({
    db: conn.db,
    kernelContext: kernel,
    resolveDefinition: (m) => defineApp({ id: m.id }),
    auth: {
      resolve: () => {
        if (role === "no-tenant") return null;
        return { tenantId, userId: "u-1", role };
      },
    },
  });

  // Mount under the same path the framework would use.
  const httpApp = new Hono();
  httpApp.route("/api/admin/apps", appsAdmin);
  return { httpApp, shellRuntime, kernel, events };
}

describe("createAppsAdminRoutes — POST /install", () => {
  it("200 + InstallRecord on success when given an inline manifest", async () => {
    const { httpApp, shellRuntime } = buildHttpApp();
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { ...validManifest, id: "k10-ok" } }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appId: string; version: string };
    expect(body.appId).toBe("k10-ok");
    expect(body.version).toBe("1.0.0");
    expect(shellRuntime.isInstalled("k10-ok")).toBe(true);

    const rows = (await conn.db.execute(sql`
      SELECT app_id FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = 'k10-ok'
    `)) as Array<{ app_id: string }>;
    expect(rows).toHaveLength(1);
  });

  it("4xx with structured errors when validation fails", async () => {
    const { httpApp } = buildHttpApp();
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { kind: "app", id: "" } }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toMatch(/validation/i);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 400 when neither url nor manifest is provided", async () => {
    const { httpApp } = buildHttpApp();
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("non-admin users get 403", async () => {
    const { httpApp } = buildHttpApp("member");
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: validManifest }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("missing tenant returns 401", async () => {
    const { httpApp } = buildHttpApp("no-tenant");
    const res = await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: validManifest }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /apps lists installed apps for the tenant", async () => {
    const { httpApp } = buildHttpApp();
    await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { ...validManifest, id: "k10-list" } }),
      }),
    );

    const res = await httpApp.fetch(new Request("http://t/api/admin/apps"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apps: Array<{ app_id: string }> };
    expect(body.apps.find((a) => a.app_id === "k10-list")).toBeTruthy();
  });

  it("GET /apps/:appId returns the install record (404 when not installed)", async () => {
    const { httpApp } = buildHttpApp();
    await httpApp.fetch(
      new Request("http://t/api/admin/apps/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { ...validManifest, id: "k10-one" } }),
      }),
    );

    const ok = await httpApp.fetch(new Request("http://t/api/admin/apps/k10-one"));
    expect(ok.status).toBe(200);

    const missing = await httpApp.fetch(new Request("http://t/api/admin/apps/never-installed"));
    expect(missing.status).toBe(404);
  });
});

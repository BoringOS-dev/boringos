// SPDX-License-Identifier: BUSL-1.1
//
// K10 — admin HTTP endpoints for the install pipeline.
//
//   GET    /api/admin/apps                         — list installed apps for tenant
//   GET    /api/admin/apps/:appId                  — single install record
//   POST   /api/admin/apps/install                 — install from URL or manifest
//   DELETE /api/admin/apps/:appId?mode=soft|hard   — uninstall (K11)
//
// The sub-app expects to be mounted under the existing `/api/admin/*`
// auth middleware (admin-routes.ts) so `c.get("tenantId")`/`c.get("role")`
// are populated. When mounted standalone (tests), we accept an
// `auth` callback that resolves identity per-request.

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import {
  fetchManifest,
  validateManifestFull,
  type KernelInstallContext,
} from "@boringos/control-plane";
import type { AppDefinition, Manifest } from "@boringos/app-sdk";
import type { Db } from "@boringos/db";

interface AppsAdminEnv {
  Variables: {
    tenantId: string;
    userId?: string;
    role?: string;
  };
}

export interface AppsAdminAuth {
  /**
   * Resolve the caller from a request context. Return null/undefined to
   * 401 the request. When mounted under the existing admin middleware
   * the caller is already resolved on the context, so this hook is
   * unused — pass `null` to short-circuit.
   */
  resolve?: (
    c: Context<AppsAdminEnv>,
  ) =>
    | Promise<{ tenantId: string; userId?: string; role?: string } | null>
    | { tenantId: string; userId?: string; role?: string }
    | null;
}

export interface CreateAppsAdminRoutesOptions {
  db: Db;
  kernelContext: KernelInstallContext;
  /**
   * Resolve an AppDefinition from a validated manifest. The HTTP path
   * doesn't ship a JS bundle interpreter, so production hosts must
   * wire this to whichever app loader they trust (filesystem,
   * registry, etc.). v1 default returns `{ id: manifest.id }` so a
   * server-only install (no UI / no agents / no workflows) still works.
   */
  resolveDefinition?: (manifest: Manifest) => Promise<AppDefinition> | AppDefinition;
  /**
   * Optional auth resolver for standalone mounting. Skip when the
   * sub-app sits behind the existing /api/admin/* middleware.
   */
  auth?: AppsAdminAuth;
}

export function createAppsAdminRoutes(
  options: CreateAppsAdminRoutesOptions,
): Hono<AppsAdminEnv> {
  const { db, kernelContext } = options;
  const resolveDefinition =
    options.resolveDefinition ??
    ((m: Manifest) => ({ id: m.id }) as AppDefinition);

  const app = new Hono<AppsAdminEnv>();

  if (options.auth?.resolve) {
    app.use("*", async (c, next) => {
      const ident = await options.auth!.resolve!(c);
      if (!ident) return c.json({ error: "Unauthorized" }, 401);
      c.set("tenantId", ident.tenantId);
      if (ident.userId) c.set("userId", ident.userId);
      if (ident.role) c.set("role", ident.role);
      await next();
    });
  }

  function requireAdmin(c: Context<AppsAdminEnv>) {
    // API-key flows and tests can pre-mark role; otherwise gate.
    const role = c.get("role");
    if (role && role !== "admin") {
      return c.json({ error: "Admin only" }, 403);
    }
    return null;
  }

  // ── List installed apps for the active tenant ─────────────────────────
  app.get("/", async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Missing tenant" }, 400);
    const rows = (await db.execute(sql`
      SELECT id, app_id, version, status, capabilities, manifest_hash,
             installed_at, updated_at
      FROM tenant_apps
      WHERE tenant_id = ${tenantId}
      ORDER BY app_id
    `)) as Array<Record<string, unknown>>;
    return c.json({ apps: rows });
  });

  // ── Single install record ────────────────────────────────────────────
  app.get("/:appId", async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Missing tenant" }, 400);
    const rows = (await db.execute(sql`
      SELECT id, app_id, version, status, capabilities, manifest_hash,
             installed_at, updated_at
      FROM tenant_apps
      WHERE tenant_id = ${tenantId} AND app_id = ${c.req.param("appId")}
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    if (!rows[0]) return c.json({ error: "Not installed" }, 404);
    return c.json(rows[0]);
  });

  // ── Install ──────────────────────────────────────────────────────────
  app.post("/install", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Missing tenant" }, 400);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Resolve the manifest. Either:
    //   - { url } — fetch over HTTP via @boringos/control-plane
    //   - { manifest, bundleText? } — passed inline
    let manifest: unknown;
    let bundleText: string | undefined;
    let manifestHash: string | undefined;

    if (typeof body.url === "string") {
      try {
        const fetched = await fetchManifest(body.url);
        manifest = fetched.manifest;
        manifestHash = fetched.hash;
        // Bundle text is fetched lazily from fetched.bundleUrl by callers
        // that need capability-honesty checks; leave undefined here so
        // the validator only runs the schema layer for v1.
      } catch (e) {
        return c.json(
          {
            error: "Failed to fetch manifest",
            detail: e instanceof Error ? e.message : String(e),
          },
          400,
        );
      }
    } else if (body.manifest && typeof body.manifest === "object") {
      manifest = body.manifest;
      bundleText = typeof body.bundleText === "string" ? body.bundleText : undefined;
      manifestHash = typeof body.manifestHash === "string" ? body.manifestHash : undefined;
    } else {
      return c.json(
        { error: "Either `url` or `manifest` is required" },
        400,
      );
    }

    // Pre-validate so we can return structured errors without
    // running the install pipeline.
    const validation = validateManifestFull(manifest, bundleText);
    if (!validation.ok) {
      return c.json(
        {
          error: "Manifest validation failed",
          issues: validation.errors,
          warnings: validation.warnings ?? [],
        },
        400,
      );
    }

    const m = manifest as Manifest;

    // Resolve the AppDefinition. If a `definition` was passed inline
    // (server-trusted), prefer it; else fall back to the resolver.
    let definition: AppDefinition;
    if (body.definition && typeof body.definition === "object") {
      definition = body.definition as AppDefinition;
    } else {
      definition = await resolveDefinition(m);
    }

    try {
      const record = await kernelContext.installApp({
        manifest: m,
        tenantId,
        bundleText,
        manifestHash,
        definition,
        bundleDir: typeof body.bundleDir === "string" ? body.bundleDir : undefined,
      });
      return c.json(record, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "Install failed", detail: message },
        500,
      );
    }
  });

  // ── Uninstall (K11) ──────────────────────────────────────────────────
  app.delete("/:appId", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Missing tenant" }, 400);
    const appId = c.req.param("appId");
    const mode = (c.req.query("mode") ?? "soft") as "soft" | "hard";
    if (mode !== "soft" && mode !== "hard") {
      return c.json({ error: "Mode must be 'soft' or 'hard'" }, 400);
    }
    const force = c.req.query("force") === "true";

    try {
      const result = await kernelContext.uninstallApp({
        tenantId,
        appId,
        mode,
        force,
      });
      return c.json(result, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not installed/i.test(message) ? 404 : 500;
      return c.json({ error: "Uninstall failed", detail: message }, status);
    }
  });

  return app;
}

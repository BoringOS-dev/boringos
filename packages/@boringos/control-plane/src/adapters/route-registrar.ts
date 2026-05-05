// SPDX-License-Identifier: BUSL-1.1
//
// K5 — route mounting registrar.
//
// The framework boots a single dispatcher Hono router (via
// `createAppRouteRegistry().router`) and mounts it on the core app
// at startup. App routes are then dynamically installed under
// `/api/{appId}/*` and removed on uninstall. The dispatcher routes by
// path lookup against an internal map, so uninstall reliably yields
// 404 without needing to mutate the underlying core router.
//
// agentDocs (when the registrar exports them) flow into the catalog
// the api-catalog context provider reads; the kernel install context
// (K7) wires the catalog into the agent engine.

import { Hono } from "hono";
import type { Hono as HonoApp, MiddlewareHandler } from "hono";

import type { AppDefinition, RouteRegistrar } from "@boringos/app-sdk";

/** Markdown source for an app's agent-facing API docs. */
export type AgentDocs = string | ((callbackUrl: string) => string);

export interface ApiCatalogEntry {
  /** Mount path, e.g. "/api/crm" */
  path: string;
  agentDocs: AgentDocs;
}

export interface InstallAppRoutesArgs {
  appId: string;
  definition: AppDefinition;
}

export interface InstalledRouteMount {
  appId: string;
  path: string;
  agentDocs: AgentDocs | null;
}

/**
 * Manages dynamic mounting of `/api/{appId}/*` routers and exposes the
 * agent-facing catalog of those mounts. Also exposes a single Hono
 * dispatcher router that the framework mounts once at startup.
 */
export interface AppRouteRegistry {
  /**
   * The dispatcher router. Mount it on the framework's core Hono app
   * (e.g. `coreApp.route("/", registry.router)`). All `/api/{appId}/*`
   * traffic flows through this router and is delegated to per-app
   * sub-Hono apps registered via `installAppRoutes`.
   */
  readonly router: HonoApp;

  /**
   * Convenience to mount the dispatcher on a core Hono app. Equivalent
   * to `coreApp.route("/", registry.router)` but doesn't require the
   * caller to know the dispatcher is at root.
   */
  attachTo(coreApp: { route: (path: string, app: HonoApp) => unknown }): void;

  /**
   * Mount an app's routes under `/api/{appId}`. The app's
   * `definition.routes` callback receives a fresh sub-Hono app to
   * register handlers on. If `definition.routes.agentDocs` is set,
   * the entry is added to the catalog.
   *
   * Re-installing the same appId replaces the prior sub-app cleanly
   * (no stale handlers left).
   */
  installAppRoutes(args: InstallAppRoutesArgs): InstalledRouteMount;

  /**
   * Drop the per-app sub-app and its catalog entry. Subsequent
   * `/api/{appId}/*` requests return 404.
   */
  uninstallAppRoutes(appId: string): void;

  /**
   * Snapshot of catalog entries for the api-catalog context provider.
   * Pass a getter form (`() => registry.getCatalog()`) into
   * `createApiCatalogProvider` so post-install installs are picked up.
   */
  getCatalog(): ApiCatalogEntry[];

  /** Whether the given appId currently has routes mounted. */
  has(appId: string): boolean;
}

export interface CreateAppRouteRegistryOptions {
  /**
   * Optional middleware applied to every per-app sub-Hono app before
   * the app's own routes register. Production wiring passes
   * `createAuthMiddleware(db)` so app routes inherit session-resolution
   * (X-Tenant-Id / X-User-Id / X-User-Role headers).
   */
  authMiddleware?: MiddlewareHandler;
}

export function createAppRouteRegistry(
  options: CreateAppRouteRegistryOptions = {},
): AppRouteRegistry {
  const subApps = new Map<string, HonoApp>();
  const docs = new Map<string, AgentDocs>();

  const router = new Hono();

  router.all("/api/:appId/*", async (c) => {
    const appId = c.req.param("appId");
    const sub = subApps.get(appId);
    if (!sub) return c.notFound();

    // Strip `/api/{appId}` from the URL so the sub-app sees its own
    // routes rooted at "/". Hono sub-apps registered via `app.route()`
    // typically expect this; doing it explicitly keeps the dispatcher
    // independent of whether the caller used `app.route()` or
    // `app.mount()` semantics.
    const url = new URL(c.req.url);
    const stripped = url.pathname.slice(`/api/${appId}`.length) || "/";
    url.pathname = stripped;
    const forwardedReq = new Request(url.toString(), c.req.raw);
    return sub.fetch(forwardedReq);
  });

  // Bare path with no trailing segment (`/api/{appId}`) — also delegate
  // so the app can mount handlers at "/" of its mount.
  router.all("/api/:appId", async (c) => {
    const appId = c.req.param("appId");
    const sub = subApps.get(appId);
    if (!sub) return c.notFound();
    const url = new URL(c.req.url);
    url.pathname = "/";
    const forwardedReq = new Request(url.toString(), c.req.raw);
    return sub.fetch(forwardedReq);
  });

  function installAppRoutes({
    appId,
    definition,
  }: InstallAppRoutesArgs): InstalledRouteMount {
    const sub = new Hono();
    if (options.authMiddleware) {
      sub.use("*", options.authMiddleware);
    }

    if (definition.routes) {
      // The SDK's RouteRegistrar callback is intentionally untyped on
      // its router argument; pass the Hono sub-app directly.
      definition.routes(sub);
    }

    subApps.set(appId, sub);

    const registrar = definition.routes as RouteRegistrar | undefined;
    const agentDocs = registrar?.agentDocs ?? null;
    if (agentDocs) docs.set(appId, agentDocs);
    else docs.delete(appId);

    return {
      appId,
      path: `/api/${appId}`,
      agentDocs,
    };
  }

  function uninstallAppRoutes(appId: string): void {
    subApps.delete(appId);
    docs.delete(appId);
  }

  function getCatalog(): ApiCatalogEntry[] {
    return Array.from(docs.entries()).map(([appId, agentDocs]) => ({
      path: `/api/${appId}`,
      agentDocs,
    }));
  }

  return {
    router,
    attachTo(coreApp) {
      coreApp.route("/", router);
    },
    installAppRoutes,
    uninstallAppRoutes,
    getCatalog,
    has: (appId: string) => subApps.has(appId),
  };
}

/**
 * Convenience wrapper matching the K5 spec signature. Equivalent to
 * `registry.installAppRoutes({ appId: app.id, definition })` but reads
 * better at the call site in K7.
 */
export function registerAppRoutes(
  registry: AppRouteRegistry,
  app: { id: string },
  definition: AppDefinition,
): InstalledRouteMount {
  return registry.installAppRoutes({ appId: app.id, definition });
}

export function unregisterAppRoutes(
  registry: AppRouteRegistry,
  app: { id: string },
): void {
  registry.uninstallAppRoutes(app.id);
}

/**
 * K5 — route mounting registrar.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import {
  createAppRouteRegistry,
  registerAppRoutes,
  unregisterAppRoutes,
} from "@boringos/control-plane";
import { defineApp } from "@boringos/app-sdk";

function fixtureApp(label: string) {
  const routes: any = (sub: Hono) => {
    sub.get("/items", (c) => c.json({ ok: true, label }));
    sub.get("/items/:id", (c) => c.json({ ok: true, label, id: c.req.param("id") }));
    sub.post("/items", async (c) => c.json({ ok: true, label, body: await c.req.json() }, 201));
  };
  routes.agentDocs = (callbackUrl: string) =>
    `### ${label} routes\n- GET ${callbackUrl}/api/${label}/items\n`;
  return defineApp({ id: label, routes });
}

describe("createAppRouteRegistry", () => {
  it("mounts at /api/{appId} and routes traffic to the per-app sub-Hono app", async () => {
    const registry = createAppRouteRegistry();
    const coreApp = new Hono();
    registry.attachTo(coreApp);

    const app = fixtureApp("crm");
    const mount = registerAppRoutes(registry, app, app);
    expect(mount.path).toBe("/api/crm");
    expect(mount.agentDocs).toBeTruthy();

    const r1 = await coreApp.fetch(new Request("http://t/api/crm/items"));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, label: "crm" });

    const r2 = await coreApp.fetch(new Request("http://t/api/crm/items/42"));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: true, label: "crm", id: "42" });

    const r3 = await coreApp.fetch(
      new Request("http://t/api/crm/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: 1 }),
      }),
    );
    expect(r3.status).toBe(201);
  });

  it("uninstall makes /api/{appId}/* return 404", async () => {
    const registry = createAppRouteRegistry();
    const coreApp = new Hono();
    registry.attachTo(coreApp);

    const app = fixtureApp("crm");
    registerAppRoutes(registry, app, app);
    expect(registry.has("crm")).toBe(true);

    const before = await coreApp.fetch(new Request("http://t/api/crm/items"));
    expect(before.status).toBe(200);

    unregisterAppRoutes(registry, app);
    expect(registry.has("crm")).toBe(false);

    const after = await coreApp.fetch(new Request("http://t/api/crm/items"));
    expect(after.status).toBe(404);
  });

  it("agentDocs flow into the catalog the api-catalog provider reads", async () => {
    const registry = createAppRouteRegistry();
    registerAppRoutes(registry, { id: "crm" }, fixtureApp("crm"));
    registerAppRoutes(registry, { id: "billing" }, fixtureApp("billing"));

    const catalog = registry.getCatalog();
    expect(catalog).toHaveLength(2);
    const paths = catalog.map((c) => c.path).sort();
    expect(paths).toEqual(["/api/billing", "/api/crm"]);

    const billingDocs = catalog.find((c) => c.path === "/api/billing")?.agentDocs;
    const rendered =
      typeof billingDocs === "function"
        ? billingDocs("http://localhost:3000")
        : billingDocs ?? "";
    expect(rendered).toContain("billing");
  });

  it("auth middleware (when provided) wraps every per-app sub-app", async () => {
    const seenHeader: string[] = [];
    const registry = createAppRouteRegistry({
      authMiddleware: async (c, next) => {
        const h = c.req.header("X-Test");
        seenHeader.push(h ?? "");
        if (!h) return c.text("unauthorized", 401);
        await next();
      },
    });
    const coreApp = new Hono();
    registry.attachTo(coreApp);
    registerAppRoutes(registry, { id: "crm" }, fixtureApp("crm"));

    const denied = await coreApp.fetch(new Request("http://t/api/crm/items"));
    expect(denied.status).toBe(401);

    const allowed = await coreApp.fetch(
      new Request("http://t/api/crm/items", { headers: { "X-Test": "yes" } }),
    );
    expect(allowed.status).toBe(200);
    expect(seenHeader).toEqual(["", "yes"]);
  });

  it("re-registering the same appId replaces the prior sub-app cleanly", async () => {
    const registry = createAppRouteRegistry();
    const coreApp = new Hono();
    registry.attachTo(coreApp);

    const v1: any = (sub: Hono) => sub.get("/version", (c) => c.text("v1"));
    const v2: any = (sub: Hono) => sub.get("/version", (c) => c.text("v2"));

    registerAppRoutes(registry, { id: "myapp" }, defineApp({ id: "myapp", routes: v1 }));
    expect(await (await coreApp.fetch(new Request("http://t/api/myapp/version"))).text()).toBe("v1");

    registerAppRoutes(registry, { id: "myapp" }, defineApp({ id: "myapp", routes: v2 }));
    expect(await (await coreApp.fetch(new Request("http://t/api/myapp/version"))).text()).toBe("v2");
  });
});

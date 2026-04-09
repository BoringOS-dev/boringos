/**
 * Phase 10 Smoke Tests — SSE / Realtime Events
 *
 * Tests the realtime bus, SSE endpoint, and event publishing from admin API.
 */
import { describe, it, expect } from "vitest";

describe("realtime bus", () => {
  it("publishes and subscribes to tenant-scoped events", async () => {
    const { createRealtimeBus } = await import("@boringos/core");
    const bus = createRealtimeBus();
    const received: string[] = [];

    bus.subscribe("tenant-1", (event) => received.push(event.type));

    bus.publish({ type: "run:started", tenantId: "tenant-1", data: {}, timestamp: new Date().toISOString() });
    bus.publish({ type: "run:started", tenantId: "tenant-2", data: {}, timestamp: new Date().toISOString() });

    // Only tenant-1 events received
    expect(received).toEqual(["run:started"]);
  });

  it("subscribeAll receives all events", async () => {
    const { createRealtimeBus } = await import("@boringos/core");
    const bus = createRealtimeBus();
    const received: string[] = [];

    bus.subscribeAll((event) => received.push(`${event.tenantId}:${event.type}`));

    bus.publish({ type: "a", tenantId: "t1", data: {}, timestamp: new Date().toISOString() });
    bus.publish({ type: "b", tenantId: "t2", data: {}, timestamp: new Date().toISOString() });

    expect(received).toEqual(["t1:a", "t2:b"]);
  });

  it("unsubscribe stops events", async () => {
    const { createRealtimeBus } = await import("@boringos/core");
    const bus = createRealtimeBus();
    const received: string[] = [];

    const unsub = bus.subscribe("t1", (event) => received.push(event.type));
    bus.publish({ type: "before", tenantId: "t1", data: {}, timestamp: new Date().toISOString() });
    unsub();
    bus.publish({ type: "after", tenantId: "t1", data: {}, timestamp: new Date().toISOString() });

    expect(received).toEqual(["before"]);
  });
});

describe("SSE endpoint", () => {
  it("rejects without API key", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-sse-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5587 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "s", adminKey: "test-sse-key" },
    });
    const server = await app.listen(0);

    try {
      const res = await fetch(`${server.url}/api/events`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 30000);

  it("rejects without tenant ID", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-sse2-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5586 },
      drive: { root: join(dataDir, "drive") },
      auth: { secret: "s", adminKey: "test-sse-key" },
    });
    const server = await app.listen(0);

    try {
      const res = await fetch(`${server.url}/api/events?apiKey=test-sse-key`);
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  }, 30000);
});

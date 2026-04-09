import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RealtimeBus } from "./realtime.js";

export function createSSERoutes(bus: RealtimeBus, adminKey: string): Hono {
  const app = new Hono();

  // GET /events — SSE stream, authenticated via API key query param or header
  app.get("/events", async (c) => {
    const key = c.req.header("X-API-Key") ?? c.req.query("apiKey");
    if (!key || key !== adminKey) {
      return c.json({ error: "Invalid or missing API key" }, 401);
    }

    const tenantId = c.req.header("X-Tenant-Id") ?? c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "Missing tenant ID" }, 400);
    }

    return streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe(tenantId, (event) => {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      });

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 30000);

      // Clean up on disconnect
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeat);
      });

      // Hold the connection open
      await new Promise(() => {});
    });
  });

  return app;
}

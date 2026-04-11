import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpServer = any; // Accepts both http.Server and Hono's ServerType
import type { CopilotManager } from "./copilot.js";

/**
 * Attaches copilot WebSocket + REST routes to the HTTP server.
 *
 * REST:
 *   POST /api/copilot/start — spawn the CLI
 *   DELETE /api/copilot/stop — kill the CLI
 *   GET /api/copilot/status — is it running?
 *
 * WebSocket:
 *   WS /api/copilot/ws — bidirectional terminal I/O
 */
export function createCopilotRoutes(manager: CopilotManager): Hono {
  const app = new Hono();

  app.post("/start", (c) => {
    if (manager.isRunning()) {
      return c.json({ status: "already_running" });
    }
    const body = c.req.query();
    const cols = parseInt(body.cols ?? "120");
    const rows = parseInt(body.rows ?? "40");
    try {
      manager.start(cols, rows);
      return c.json({ status: "started" });
    } catch (err) {
      return c.json({ status: "error", error: String(err) }, 500);
    }
  });

  app.delete("/stop", (c) => {
    manager.stop();
    return c.json({ status: "stopped" });
  });

  app.get("/status", (c) => {
    return c.json({ running: manager.isRunning() });
  });

  return app;
}

/**
 * Attaches WebSocket upgrade handling to the HTTP server.
 * Listens on /api/copilot/ws path.
 */
export function attachCopilotWebSocket(server: HttpServer, manager: CopilotManager): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: any, socket: any, head: any) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    if (url.pathname !== "/api/copilot/ws") return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      // If not running, start with default size
      if (!manager.isRunning()) {
        try { manager.start(); } catch { ws.close(); return; }
      }

      // PTY → WebSocket
      manager.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // WebSocket → PTY
      ws.on("message", (data) => {
        const msg = data.toString();

        // Handle resize messages: JSON { type: "resize", cols, rows }
        if (msg.startsWith("{")) {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === "resize" && parsed.cols && parsed.rows) {
              manager.resize(parsed.cols, parsed.rows);
              return;
            }
          } catch {
            // Not JSON, treat as terminal input
          }
        }

        manager.write(msg);
      });

      // Cleanup on close
      ws.on("close", () => {
        // Don't kill the PTY — session stays alive for reconnect
      });

      // Notify on PTY exit
      manager.onExit((code) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\r\n[Session ended with code ${code}]\r\n`);
          ws.close();
        }
      });
    });
  });
}

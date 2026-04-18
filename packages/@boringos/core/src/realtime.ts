import { EventEmitter } from "node:events";

// ── Event types ──────────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export const EVENT_TYPES = [
  "run:started",
  "run:completed",
  "run:failed",
  "run:log_line",
  "run:stderr_line",
  "task:created",
  "task:updated",
  "task:comment_added",
  "agent:created",
  "agent:updated",
  "agent:woken",
  "agent:reparented",
  "approval:created",
  "approval:decided",
  "workflow:started",
  "workflow:completed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ── Realtime bus ─────────────────────────────────────────────────────────────

export interface RealtimeBus {
  publish(event: RealtimeEvent): void;
  subscribe(tenantId: string, listener: (event: RealtimeEvent) => void): () => void;
  subscribeAll(listener: (event: RealtimeEvent) => void): () => void;
}

export function createRealtimeBus(): RealtimeBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(1000); // many concurrent SSE connections

  return {
    publish(event: RealtimeEvent): void {
      emitter.emit(`tenant:${event.tenantId}`, event);
      emitter.emit("*", event);
    },

    subscribe(tenantId: string, listener: (event: RealtimeEvent) => void): () => void {
      const channel = `tenant:${tenantId}`;
      emitter.on(channel, listener);
      return () => emitter.off(channel, listener);
    },

    subscribeAll(listener: (event: RealtimeEvent) => void): () => void {
      emitter.on("*", listener);
      return () => emitter.off("*", listener);
    },
  };
}

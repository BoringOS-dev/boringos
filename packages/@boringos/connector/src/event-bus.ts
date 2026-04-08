import type { ConnectorEvent } from "./types.js";

export type EventHandler = (event: ConnectorEvent) => void | Promise<void>;

export interface EventBus {
  emit(event: ConnectorEvent): Promise<void>;
  on(type: string, handler: EventHandler): void;
  onAny(handler: EventHandler): void;
  off(type: string, handler: EventHandler): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  const globalHandlers = new Set<EventHandler>();

  return {
    async emit(event: ConnectorEvent): Promise<void> {
      const typeHandlers = handlers.get(event.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          try { await handler(event); } catch { /* handler errors don't propagate */ }
        }
      }
      for (const handler of globalHandlers) {
        try { await handler(event); } catch { /* handler errors don't propagate */ }
      }
    },

    on(type: string, handler: EventHandler): void {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },

    onAny(handler: EventHandler): void {
      globalHandlers.add(handler);
    },

    off(type: string, handler: EventHandler): void {
      handlers.get(type)?.delete(handler);
    },
  };
}

import type { BlockHandler } from "./types.js";

export function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, BlockHandler>();

  return {
    register(handler: BlockHandler): void {
      for (const type of handler.types) {
        handlers.set(type, handler);
      }
    },

    get(type: string): BlockHandler | undefined {
      return handlers.get(type);
    },

    has(type: string): boolean {
      return handlers.has(type);
    },

    list(): BlockHandler[] {
      return Array.from(new Set(handlers.values()));
    },
  };
}

export interface HandlerRegistry {
  register(handler: BlockHandler): void;
  get(type: string): BlockHandler | undefined;
  has(type: string): boolean;
  list(): BlockHandler[];
}

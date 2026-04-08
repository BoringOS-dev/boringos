import type { Hook, HookHandler } from "./types.js";

export function createHook<T>(): Hook<T> {
  const handlers: Set<HookHandler<T>> = new Set();

  return {
    use(handler: HookHandler<T>) {
      handlers.add(handler);
    },

    remove(handler: HookHandler<T>) {
      handlers.delete(handler);
    },

    async run(event: T) {
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch {
          // Error in one handler does not kill subsequent handlers.
          // Consumers who need error visibility should wrap their handler.
        }
      }
    },
  };
}

import type { QueueAdapter } from "./types.js";
import { generateId } from "@boringos/shared";

export function createInProcessQueue<T>(): QueueAdapter<T> {
  const jobs: T[] = [];
  let handler: ((job: T) => Promise<void>) | null = null;
  let processing = false;
  let closed = false;

  async function drain(): Promise<void> {
    if (processing || !handler) return;
    processing = true;

    while (jobs.length > 0 && !closed) {
      const job = jobs.shift()!;
      try {
        await handler(job);
      } catch {
        // In-process queue has no retry — errors are swallowed.
        // Use BullMQ for production retry semantics.
      }
    }

    processing = false;
  }

  return {
    name: "in-process",

    async enqueue(job: T): Promise<string> {
      if (closed) throw new Error("Queue is closed");
      const id = generateId();
      jobs.push(job);
      setImmediate(() => drain());
      return id;
    },

    process(fn: (job: T) => Promise<void>): void {
      handler = fn;
      // Drain any jobs that were enqueued before handler was set
      if (jobs.length > 0) setImmediate(() => drain());
    },

    async close(): Promise<void> {
      closed = true;
    },
  };
}

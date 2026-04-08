import { Queue, Worker } from "bullmq";
import type { QueueAdapter } from "./types.js";

export interface BullMQConfig {
  redis: string;
  queueName?: string;
  concurrency?: number;
}

export function createBullMQQueue<T>(config: BullMQConfig): QueueAdapter<T> {
  const queueName = config.queueName ?? "boringos-jobs";
  const concurrency = config.concurrency ?? 1;

  const queue = new Queue(queueName, {
    connection: { url: config.redis },
  });

  let worker: Worker | null = null;

  return {
    name: "bullmq",

    async enqueue(job: T): Promise<string> {
      const result = await queue.add("job", job as Record<string, unknown>, {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
      });
      return result.id ?? "";
    },

    process(handler: (job: T) => Promise<void>): void {
      worker = new Worker(
        queueName,
        async (bullJob) => {
          await handler(bullJob.data as T);
        },
        {
          connection: { url: config.redis },
          concurrency,
        },
      );
    },

    async close(): Promise<void> {
      if (worker) await worker.close();
      await queue.close();
    },
  };
}

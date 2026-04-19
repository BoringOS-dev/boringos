# @boringos/pipeline

Pluggable job queue for BoringOS agent execution. In-process by default, BullMQ for production.

## Install

```bash
npm install @boringos/pipeline
```

## Usage

```typescript
import { createInProcessQueue, createBullMQQueue } from "@boringos/pipeline";
import type { QueueAdapter } from "@boringos/pipeline";

// Development: in-process queue (no Redis, zero config)
const devQueue = createInProcessQueue<{ taskId: string }>();

// Or with parallelism — up to N jobs processed simultaneously.
// Each slot runs an independent drain loop, so concurrent agent subprocesses.
// Pick based on machine size + API rate limits; unbounded is a foot-gun.
const parallelQueue = createInProcessQueue<{ taskId: string }>({ concurrency: 4 });

// Production: BullMQ with Redis
const prodQueue = createBullMQQueue<{ taskId: string }>({
  redis: "redis://localhost:6379",
  queueName: "agent-jobs",
  concurrency: 5,
});

// Enqueue a job
await queue.enqueue({ taskId: "task_123" });

// Process jobs
queue.process(async (job) => {
  console.log("Processing:", job.taskId);
});

// Shutdown
await queue.close();
```

### With BoringOS

```typescript
import { BoringOS } from "@boringos/core";
import { createBullMQQueue } from "@boringos/pipeline";

// Default: in-process, serial (concurrency 1).
// Bump parallelism via BoringOS config — no need to construct a queue yourself:
const app = new BoringOS({
  queue: { concurrency: 4 },
});

// Or, for production: opt into BullMQ explicitly.
// (Overrides `config.queue` — when you pass your own adapter, BoringOS stops
// creating the default in-process one.)
app.queue(createBullMQQueue({ redis: "redis://localhost:6379" }));
```

## API Reference

### Queue Factories

| Export | Description |
|---|---|
| `createInProcessQueue<T>(options?)` | Zero-config queue. Default is sequential (`concurrency: 1`); pass `{ concurrency: N }` to process up to N jobs in parallel. No persistence or retries. |
| `createBullMQQueue<T>(config)` | Redis-backed queue with persistent jobs, automatic retries, configurable concurrency. |

### `QueueAdapter<T>` Interface

| Method | Description |
|---|---|
| `enqueue(job: T)` | Add a job to the queue |
| `process(handler)` | Register a job handler |
| `close()` | Shut down the queue |

### Types

`QueueAdapter<T>`, `InProcessQueueOptions`, `BullMQConfig`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

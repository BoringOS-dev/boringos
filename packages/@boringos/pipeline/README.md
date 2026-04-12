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

const app = new BoringOS({});

// Default: in-process (no Redis needed)
// Production: opt-in BullMQ
app.queue(createBullMQQueue({ redis: "redis://localhost:6379" }));
```

## API Reference

### Queue Factories

| Export | Description |
|---|---|
| `createInProcessQueue<T>()` | Zero-config queue, sequential processing via event loop. No persistence or retries. |
| `createBullMQQueue<T>(config)` | Redis-backed queue with persistent jobs, automatic retries, configurable concurrency. |

### `QueueAdapter<T>` Interface

| Method | Description |
|---|---|
| `enqueue(job: T)` | Add a job to the queue |
| `process(handler)` | Register a job handler |
| `close()` | Shut down the queue |

### Types

`QueueAdapter<T>`, `BullMQConfig`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

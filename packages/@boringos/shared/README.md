# @boringos/shared

Foundation types, constants, and utilities used by all BoringOS packages.

## Install

```bash
npm install @boringos/shared
```

## Usage

```typescript
import {
  createHook,
  generateId,
  slugify,
  sanitizePath,
} from "@boringos/shared";
import type { Agent, Task, AgentRun, Hook } from "@boringos/shared";

// Typed event hooks
const onTaskCreated = createHook<Task>();
onTaskCreated.on((task) => console.log("New task:", task.id));
await onTaskCreated.emit(myTask);

// Generate a unique ID
const id = generateId(); // "bos_abc123..."

// Slugify a string
const slug = slugify("My Agent Name"); // "my-agent-name"

// Sanitize file paths (prevents traversal)
const safe = sanitizePath("../etc/passwd"); // throws
```

## API Reference

### Types

| Type | Description |
|---|---|
| `Agent` | Agent definition (name, runtime, persona, instructions) |
| `Task` | Task with status, priority, assignee, parent |
| `AgentRun` | Single execution record |
| `Approval` | Human-in-the-loop approval request |
| `Routine` | Cron-scheduled recurring wakeup |
| `TaskComment` | Comment on a task |
| `Hook<T>` | Typed event hook |
| `SkillProvider` | Interface for components that ship skill markdown |

### Constants

`AGENT_STATUSES`, `TASK_STATUSES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `APPROVAL_STATUSES`, `ROUTINE_STATUSES`, `WAKE_REASONS`, `CONCURRENCY_POLICIES`, `CATCH_UP_POLICIES`

### Utilities

| Function | Description |
|---|---|
| `createHook<T>()` | Create a typed event hook with `.on()` and `.emit()` |
| `generateId()` | Generate a unique prefixed ID |
| `slugify(str)` | Convert string to URL-safe slug |
| `sanitizePath(path)` | Validate path against traversal attacks |

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

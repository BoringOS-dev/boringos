# @boringos/workflow

DAG-based workflow engine for BoringOS with typed block handlers, condition branching, and template resolution.

## Install

```bash
npm install @boringos/workflow
```

## Usage

```typescript
import {
  buildDAG,
  createWorkflowEngine,
  createWorkflowStore,
  createHandlerRegistry,
  createExecutionState,
  triggerHandler,
  conditionHandler,
  delayHandler,
  transformHandler,
  wakeAgentHandler,
} from "@boringos/workflow";

// Register block handlers
const handlers = createHandlerRegistry();
handlers.register(triggerHandler);
handlers.register(conditionHandler);
handlers.register(delayHandler);
handlers.register(transformHandler);
handlers.register(wakeAgentHandler);

// Create workflow store (Drizzle-backed)
const store = createWorkflowStore(db);

// Create the engine
const engine = createWorkflowEngine({ store, handlers, services });

// Build and execute a DAG
const dag = buildDAG(blocks, edges);
const result = await engine.run(workflowId, { type: "webhook", data: {} });
```

### Template Resolution

Block configs can reference outputs from previous blocks:

```typescript
import { resolveTemplate } from "@boringos/workflow";

// {{blockName.field}} syntax
const resolved = resolveTemplate(
  "Hello {{trigger.user_name}}",
  executionState,
  nameToIdMap
);
```

## API Reference

### Core

| Export | Description |
|---|---|
| `buildDAG(blocks, edges)` | Construct executable graph from block/edge arrays |
| `createWorkflowEngine(config)` | Core execution loop with topological walk |
| `createWorkflowStore(db)` | Drizzle-backed CRUD for workflow definitions |
| `createHandlerRegistry()` | Maps block types to handlers |
| `createExecutionState()` | Tracks block status + outputs during execution |
| `resolveTemplate(tpl, state, map)` | Substitute `{{blockName.field}}` references |

### Built-in Handlers (9)

| Handler | Description |
|---|---|
| `triggerHandler` | Entry point (cron, webhook, event) |
| `conditionHandler` | True/false branching via `selectedHandle` |
| `delayHandler` | Wait for a duration |
| `transformHandler` | Data mapping/transformation |
| `wakeAgentHandler` | Wake an agent |
| `connectorActionHandler` | Invoke a connector action |
| `forEachHandler` | Iterate over a collection |
| `createInboxItemHandler` | Create an inbox item |
| `emitEventHandler` | Emit an event to the event bus |

### Types

`DAG`, `DAGNode`, `DAGEdge`, `BlockHandler`, `BlockHandlerContext`, `WorkflowEngine`, `WorkflowStore`, `WorkflowDefinition`, `ExecutionState`, `TriggerType`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

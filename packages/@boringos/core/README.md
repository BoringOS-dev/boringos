# @boringos/core

The application host -- entry point for BoringOS. Builder pattern, Hono HTTP API, agent callbacks, admin API, SSE, auth, plugins, scheduler, and more.

## Install

```bash
npm install @boringos/core
```

## Usage

```typescript
import { BoringOS } from "@boringos/core";

const app = new BoringOS({
  auth: { adminKey: "my-secret-key" },
});

// Optional integrations
import { createHebbsMemory } from "@boringos/memory";
import { slack } from "@boringos/connector-slack";
import { createBullMQQueue } from "@boringos/pipeline";

app
  .memory(createHebbsMemory({ endpoint: "...", apiKey: "..." }))
  .connector(slack({ signingSecret: "..." }))
  .queue(createBullMQQueue({ redis: "redis://localhost:6379" }))
  .contextProvider(myCustomProvider)
  .blockHandler(myCustomHandler)
  .plugin(myPlugin)
  .beforeStart(async () => console.log("Booting..."))
  .route("/custom", customHonoApp);

await app.listen(3000);
```

## API Reference

### `BoringOS` Class

**Builder methods:**

| Method | Description |
|---|---|
| `.memory(provider)` | Set memory provider |
| `.runtime(module)` | Register additional runtime |
| `.contextProvider(provider)` | Add custom context provider |
| `.persona(role, bundle)` | Register custom persona |
| `.queue(adapter)` | Set job queue adapter |
| `.connector(definition)` | Register a connector |
| `.blockHandler(handler)` | Register workflow block handler |
| `.plugin(manifest)` | Register a plugin |
| `.schema(ddl)` | Add custom database tables |
| `.routeToInbox(config)` | Route connector events to inbox |
| `.beforeStart(fn)` / `.afterStart(fn)` / `.beforeShutdown(fn)` | Lifecycle hooks |
| `.route(path, app)` | Mount custom Hono routes |
| `.listen(port?)` | Boot everything and start HTTP server |

### HTTP APIs

| API | Auth | Description |
|---|---|---|
| `/health` | None | Health check |
| `/api/agent/*` | JWT (auto-generated) | Agent callback API (tasks, comments, costs) |
| `/api/admin/*` | API key or session token | Full CRUD for agents, tasks, runs, runtimes, approvals, etc. |
| `/api/auth/*` | None | Signup, login, logout, device auth |
| `/api/events` | API key | Server-Sent Events for realtime updates |
| `/webhooks/plugins/:name/:event` | None | Plugin webhook ingress |

### Re-exports

Key types from sub-packages are re-exported for convenience: `MemoryProvider`, `RuntimeModule`, `StorageBackend`, `AgentEngine`, `ContextProvider`, `WorkflowEngine`, `BlockHandler`.

Also re-exports `nullMemory`, `createHebbsMemory`, `createRealtimeBus`, `createNotificationService`, `createPluginRegistry`, `githubPlugin`.

### Types

`BoringOSConfig`, `AuthConfig`, `PluginDefinition`, `RealtimeBus`, `RealtimeEvent`, `NotificationService`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

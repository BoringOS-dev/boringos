# BoringOS

> A framework for building agentic platforms. Like Rails extracted from Basecamp — but for AI agents.

## Quick Start

```typescript
import { BoringOS } from "@boringos/core";

const app = new BoringOS({});
const server = await app.listen(3000);
// Embedded Postgres boots, schema created, 6 runtimes registered
// Agent callback API at /api/agent/* (JWT authenticated)
// Health check at /health
```

Or scaffold a new project:

```bash
npx create-boringos my-app
cd my-app && npm run dev
```

Zero external dependencies required. Embedded Postgres starts automatically.

## What is BoringOS?

BoringOS is a framework that lets you build platforms where AI agents receive tasks, execute autonomously via CLI tools, and report back. Agents run as CLI subprocesses (Claude Code, Codex, Gemini CLI, Ollama, or any command), not via raw LLM API calls.

The framework handles:
- **Agent execution pipeline** — wake → queue → build context → spawn runtime → stream output → persist state
- **Context assembly** — 12 composable providers that build system instructions + task context
- **6 runtime adapters** — Claude, ChatGPT, Gemini, Ollama, generic command, webhook
- **12 persona bundles** — CEO, CTO, engineer, researcher, PM, QA, DevOps, designer, PA, content creator, finance, default
- **Workflow engine** — DAG-based execution with condition branching, delays, and transforms
- **Cognitive memory** — pluggable memory providers (Hebbs or custom)
- **File storage** — local drive with organization rules agents understand
- **Database** — embedded or external Postgres with Drizzle ORM
- **JWT-authenticated callback API** — agents call back to update tasks, post comments, record work products
- **Convention over configuration** — everything works with zero config

## Packages

| Package | Purpose |
|---|---|
| `@boringos/core` | Application host — `BoringOS` class, builder API, HTTP server |
| `@boringos/agent` | Execution engine — context pipeline, wakeup coalescing, run lifecycle, personas |
| `@boringos/runtime` | 6 runtime modules + registry + subprocess spawning |
| `@boringos/memory` | `MemoryProvider` interface + Hebbs provider + null provider |
| `@boringos/drive` | `StorageBackend` interface + local filesystem implementation |
| `@boringos/db` | Drizzle schema (17 tables) + embedded Postgres + migration manager |
| `@boringos/workflow` | DAG workflow engine + block handlers + workflow store |
| `@boringos/pipeline` | Pluggable job queue — in-process (default) or BullMQ (opt-in) |
| `@boringos/connector` | Connector SDK — interfaces, registry, OAuth, EventBus, test harness |
| `@boringos/connector-slack` | Slack reference connector (messages, threads, reactions) |
| `@boringos/connector-google` | Google Workspace connector (Gmail + Calendar) |
| `@boringos/ui` | Typed API client + headless React hooks (TanStack Query) |
| `create-boringos` | CLI generator — `npx create-boringos my-app` |
| `@boringos/shared` | Base types, constants, Hook utility, ID generation |

## Builder API

```typescript
import { BoringOS, createHebbsMemory } from "@boringos/core";

const app = new BoringOS({
  database: { url: "postgres://..." },        // or omit for embedded
  drive: { root: "./data/drive" },             // or omit for default
  auth: { secret: "your-secret" },             // JWT signing secret
});

app.memory(createHebbsMemory({ endpoint: "...", apiKey: "..." }));
app.connector(slack({ signingSecret: "..." }));         // Slack integration
app.connector(google({ clientId: "...", clientSecret: "..." })); // Gmail + Calendar
app.queue(createBullMQQueue({ redis: "redis://..." })); // opt-in BullMQ
app.runtime(myCustomRuntime);                  // add custom runtimes
app.contextProvider(myProvider);               // add custom context providers
app.blockHandler(myWorkflowHandler);           // add custom workflow block handlers
app.persona("platform-engineer", bundle);      // add custom personas
app.plugin(myPlugin);                          // register plugins
app.beforeStart(async (ctx) => { ... });       // lifecycle hooks
app.route("/custom", honoApp);                 // mount custom routes

const server = await app.listen(3000);
```

## Commands

```bash
pnpm install           # Install dependencies
pnpm -r build          # Build all packages
pnpm -r typecheck      # Typecheck all packages
pnpm test:run          # Run all tests (80 tests)
```

## Examples

- [`examples/quickstart/`](examples/quickstart/) — Boot, create an agent, assign a task, watch it execute

## Detailed Docs

See [CLAUDE.md](CLAUDE.md) for the full agent orientation guide — package details, execution pipeline, all interfaces, environment variables.

## License

MIT

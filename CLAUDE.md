# BoringOS — CLAUDE.md

> Agent orientation guide. Read this first before making any changes.
> Last synced with implementation: 2026-04-08 (workflow engine, JWT auth, examples)

## What is BoringOS?

BoringOS is an **open-source framework for building agentic platforms** — systems where AI agents receive tasks, execute autonomously, and report back. Think: Rails for AI agents.

**Key principle:** Agents always run as agentic CLI tools (Claude Code, Codex, Gemini CLI, Ollama, etc.). The framework never calls LLM APIs directly — CLIs are the agents, BoringOS is the orchestrator.

---

## Monorepo Layout

```
boringos/
├── packages/@boringos/
│   ├── shared/           # Base types, constants, Hook<T>, utilities
│   ├── memory/           # MemoryProvider interface + Hebbs + nullMemory
│   ├── runtime/          # 6 runtime modules + registry + subprocess spawning
│   ├── drive/            # StorageBackend interface + local filesystem
│   ├── db/               # Drizzle schema + embedded Postgres + migrations
│   ├── agent/            # Execution engine, context pipeline, wakeups, personas
│   ├── workflow/         # DAG workflow engine + block handlers + store
│   ├── pipeline/         # QueueAdapter interface + InProcess + BullMQ
│   ├── connector/        # Connector SDK — interfaces, registry, OAuth, EventBus
│   ├── connector-slack/  # Slack reference connector
│   ├── connector-google/ # Google Workspace reference connector (Gmail + Calendar)
│   ├── create-boringos/# CLI generator (npx create-boringos)
│   ├── ui/               # Typed API client + headless React hooks
│   └── core/             # BoringOS class, Hono callback API, app bootstrap
├── examples/
│   └── quickstart/       # Runnable quickstart example
├── tests/                # Smoke tests (accumulated per phase, 80 tests)
├── plans/                # Architecture and implementation plans
├── LICENSE               # MIT
└── vitest.config.ts      # Test configuration
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| HTTP server | [Hono](https://hono.dev/) on Node.js |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) |
| Embedded DB | `embedded-postgres` (zero-config development) |
| Memory | [Hebbs](https://hebbs.ai/) (pluggable via `MemoryProvider`) |
| Language | TypeScript (ESM, `"type": "module"`) |
| Runtime | Node.js ≥ 22 |
| Package manager | pnpm 9 |
| Testing | Vitest |
| License | MIT |

---

## Commands

```bash
pnpm install              # Install dependencies
pnpm -r build             # Build all packages
pnpm -r typecheck         # Typecheck all packages
pnpm test:run             # Run all tests (single pass)
pnpm test                 # Watch mode
```

---

## Package Details

### `@boringos/shared`

Foundation types used by all other packages.

- **Types:** `Agent`, `Task`, `AgentRun`, `Approval`, `Routine`, `TaskComment`
- **Base types:** `Identifiable`, `Timestamped`, `TenantScoped`
- **Constants:** `AGENT_STATUSES`, `TASK_STATUSES`, `RUN_STATUSES`, `WAKE_REASONS`, etc.
- **Interfaces:** `SkillProvider` (Code + Knowledge pattern), `Hook<T>` (typed event system)
- **Utilities:** `createHook()`, `generateId()`, `slugify()`, `sanitizePath()`

### `@boringos/memory`

Pluggable cognitive memory system.

- **`MemoryProvider`** interface: `remember`, `recall`, `prime`, `forget`, `ping`, `skillMarkdown`
- **`nullMemory`** — no-op provider (default)
- **`createHebbsMemory(config)`** — Hebbs HTTP client implementing `MemoryProvider`
- Every provider includes `skillMarkdown()` that teaches agents how to use memory

### `@boringos/runtime`

Agent execution backends. Each runtime spawns a CLI subprocess.

- **6 built-in runtimes:** `claude`, `chatgpt`, `gemini`, `ollama`, `command`, `webhook`
- **`createRuntimeRegistry()`** — injectable registry with alias resolution
- **`spawnAgent()`** — subprocess spawning utility with stdin/stdout/stderr streaming
- **`detectCli()`** — checks if a CLI tool is available on PATH
- Each runtime implements `testEnvironment()` for health checks and `skillMarkdown()`

### `@boringos/drive`

File storage abstraction.

- **`StorageBackend`** interface: `read`, `readText`, `write`, `delete`, `exists`, `list`, `move`, `stat`
- **`createLocalStorage({ root })`** — filesystem backend with path traversal protection
- **`scaffoldDrive(root, tenantId)`** — creates default folder structure
- Includes drive skill markdown for agent file organization

### `@boringos/db`

Database schema and connection management.

- **17 framework tables** with `tenantId` (not `companyId`) — multi-tenant by default
- **`createDatabase(config)`** — boots embedded Postgres or connects to external URL
- **`createMigrationManager(db)`** — schema bootstrap via DDL
- **Key tables:** `tenants`, `agents`, `tasks`, `agent_runs`, `agent_wakeup_requests`, `runtimes`, `cost_events`, `approvals`, `workflows`, `connectors`, `drive_files`, `activity_log`

### `@boringos/agent`

The execution engine — the core of the framework.

- **`createAgentEngine(config)`** — the orchestrator with hooks: `beforeRun`, `buildContext`, `afterRun`, `onCost`, `onError`
- **`ContextPipeline`** — composable pipeline of `ContextProvider` instances, sorted by phase (system/context) and priority
- **12 built-in context providers:**
  - System: header, persona, tenant guidelines, drive skill, memory skill, agent instructions, execution protocol
  - Context: session (3 modes), task, comments, memory context, approval
- **`createWakeup(db, request)`** — wakeup coalescing (prevents duplicate runs)
- **`createRunLifecycle(db)`** — run status tracking, log appending
- **Persona system:** 12 persona bundles (34 markdown files), role resolution with 30+ aliases
- **Pluggable job queue** — in-process default (no Redis), BullMQ opt-in via `@boringos/pipeline`

### `@boringos/workflow`

DAG-based workflow engine with typed block handlers and condition branching.

- **`buildDAG(blocks, edges)`** — constructs executable graph from block/edge arrays
- **`createWorkflowEngine({ store, handlers, services })`** — core execution loop with topological walk
- **`createWorkflowStore(db)`** — Drizzle-backed CRUD for workflow definitions
- **`createHandlerRegistry()`** — maps block types to handlers
- **`createExecutionState()`** — tracks block status + outputs during execution
- **`resolveTemplate(template, state, nameToId)`** — substitutes `{{blockName.field}}` references
- **4 built-in handlers:** `trigger` (entry point), `condition` (true/false branching), `delay` (wait), `transform` (data mapping)
- **Branching:** condition blocks return `selectedHandle` (e.g., `condition-true`/`condition-false`) that determines which downstream edges activate
- **Trigger types:** `cron`, `webhook`, `event`

### `@boringos/pipeline`

Pluggable job queue for agent execution.

- **`QueueAdapter<T>`** interface: `enqueue(job)`, `process(handler)`, `close()`
- **`createInProcessQueue()`** — default, zero-config, no Redis. Jobs process sequentially via event loop. No persistence or retries.
- **`createBullMQQueue({ redis, queueName?, concurrency? })`** — opt-in production queue backed by Redis. Persistent jobs, automatic retries, configurable concurrency.
- Default: in-process (no Redis required). Opt-in BullMQ via `.queue()` on `BoringOS` builder.

```typescript
// Default — no Redis needed
const app = new BoringOS({});

// Production — BullMQ with Redis
import { createBullMQQueue } from "@boringos/pipeline";
app.queue(createBullMQQueue({ redis: "redis://localhost:6379" }));
```

### `@boringos/connector` — SDK

The connector framework — implement this interface to integrate any external service.

- **`ConnectorDefinition`** — the one interface connector authors implement: `kind`, `name`, `oauth`, `events`, `actions`, `createClient()`, `handleWebhook()`, `skillMarkdown()`
- **`createConnectorRegistry()`** — register/lookup/list connectors
- **`createOAuthManager(config, clientId, clientSecret)`** — handles authorization URL, code exchange, token refresh
- **`createEventBus()`** — typed event bus, connectors emit events, framework routes them
- **`createActionRunner(registry)`** — agents invoke connector actions via callback API
- **`createConnectorTestHarness(connector)`** — test utility: mock OAuth, simulate webhooks, inspect events

### `@boringos/connector-slack`

Slack reference implementation. Usage: `app.connector(slack({ signingSecret: "..." }))`

- **Events:** `message_received`, `mention`, `reaction_added`
- **Actions:** `send_message`, `reply_in_thread`, `add_reaction`
- **Webhook handler** with signature verification
- **Skill file** teaches agents about channels, threads, formatting

### `@boringos/connector-google`

Google Workspace reference implementation. Usage: `app.connector(google({ clientId: "...", clientSecret: "..." }))`

- **Gmail actions:** `list_emails`, `read_email`, `send_email`, `search_emails`
- **Calendar actions:** `list_events`, `create_event`, `update_event`, `find_free_slots`
- **Events:** `email_received`, `calendar_event_created`, `calendar_event_updated`
- **Skill files** covering Gmail query syntax and Calendar scheduling guidelines

### `create-boringos` — CLI Generator

Scaffolds a new BoringOS project.

```bash
npx create-boringos my-app              # minimal template
npx create-boringos my-app --full       # full template with all integrations
```

- **`minimal` template** — `@boringos/core` only, 20-line `index.ts`, boots with zero config
- **`full` template** — includes memory, Slack, Google, BullMQ, custom context provider example
- Generates: `package.json`, `tsconfig.json`, `src/index.ts`, `.env.example`, `.gitignore`, `README.md`
- Template variables (`{{name}}`) replaced with project name
- Detects package manager (pnpm/yarn/npm) and runs install

### `@boringos/ui` — Headless React Hooks

Typed API client + React hooks for building dashboards on top of BoringOS. No markup, no styles — just data and mutations.

**API Client** (framework-agnostic, no React):
- `createBoringOSClient({ url, token? })` — typed fetch wrapper for all REST endpoints
- Methods: `health()`, `getAgents()`, `createAgent()`, `getTasks()`, `getTask()`, `createTask()`, `updateTask()`, `postComment()`, `addWorkProduct()`, `getRuns()`, `reportCost()`, `getConnectors()`, `invokeAction()`

**React Provider:**
- `<BoringOSProvider client={client}>` — wraps app with client context + TanStack Query

**React Hooks:**
| Hook | Returns | Mutations |
|---|---|---|
| `useAgents()` | agents list, loading | `createAgent` |
| `useTasks()` | tasks list, loading | `createTask` |
| `useTask(taskId)` | task + comments | `updateStatus`, `postComment`, `addWorkProduct` |
| `useRuns()` | runs list (polls every 5s) | — |
| `useConnectors()` | connector list | `invokeAction` |
| `useHealth()` | server status (polls every 30s) | — |

**Usage:**
```tsx
import { BoringOSProvider, createBoringOSClient, useAgents } from "@boringos/ui";

const client = createBoringOSClient({ url: "http://localhost:3000", token: "..." });

function App() {
  return (
    <BoringOSProvider client={client}>
      <AgentList />
    </BoringOSProvider>
  );
}

function AgentList() {
  const { agents, isLoading, createAgent } = useAgents();
  // render with your own components...
}
```

### `@boringos/core`

Application host — the entry point.

- **`BoringOS`** class with builder pattern:
  - `.memory(provider)` — set memory provider
  - `.runtime(module)` — register additional runtime
  - `.contextProvider(provider)` — add custom context provider
  - `.persona(role, bundle)` — register custom persona
  - `.queue(adapter)` — set job queue adapter (default: in-process, opt-in: BullMQ)
  - `.blockHandler(handler)` — register custom workflow block handler
  - `.plugin(manifest)` — register plugin
  - `.beforeStart(fn)` / `.afterStart(fn)` / `.beforeShutdown(fn)` — lifecycle hooks
  - `.route(path, app)` — mount custom Hono routes
  - `.listen(port?)` — boot everything and start HTTP server
- **Agent callback API** (Hono routes at `/api/agent/*`, JWT authenticated):
  - `GET /tasks/:taskId` — read task + comments
  - `PATCH /tasks/:taskId` — update task status/title/description
  - `POST /tasks` — create task (subtasks via `parentId`)
  - `POST /tasks/:taskId/comments` — post comment
  - `POST /tasks/:taskId/work-products` — record deliverable
  - `POST /runs/:runId/cost` — report token usage
  - `POST /agents` — create agent
- **`GET /health`** — health check endpoint (unauthenticated)

---

## Agent Execution Pipeline

```
1. Wake request    →  createWakeup() with coalescing
2. Enqueue         →  in-process job queue
3. Fetch agent     →  DB lookup
4. Create run      →  agent_runs row (status: running)
5. Build context   →  ContextPipeline runs all providers
   ├── System instructions: header → persona → guidelines → skills → protocol
   └── Context markdown: session → task → comments → memory → approval
6. Resolve runtime →  DB lookup → registry.get(type)
7. Execute         →  runtime.execute() spawns CLI subprocess
8. Stream output   →  callbacks: onOutputLine, onStderrLine, onCostEvent
9. Complete        →  update run status, persist session state
```

---

## Callback API Authentication

The callback API uses **HMAC-SHA256 signed JWTs** (4-hour expiry, no external dependency).

- **Token generation:** The engine signs a JWT when spawning an agent run, containing `{ sub: runId, agent_id, tenant_id, exp }`
- **Token delivery:** Injected as `BORINGOS_CALLBACK_TOKEN` env var into the agent subprocess
- **Token verification:** Middleware on all `/api/agent/*` routes verifies signature + expiry
- **Claims extraction:** Routes read `agentId`/`tenantId` from JWT claims, not from request body — agents cannot impersonate others
- **`/health` is unauthenticated** — no token needed
- **Secret:** Configured via `auth.secret` in `BoringOSConfig` (defaults to random per boot)
- **JWT utilities:** `signCallbackToken()` and `verifyCallbackToken()` exported from `@boringos/agent`

---

## Key Patterns

### Adding a custom context provider

```typescript
const myProvider: ContextProvider = {
  name: "my-context",
  phase: "context",  // "system" or "context"
  priority: 25,      // lower = earlier
  async provide(event) {
    return `## My Section\n\nCustom context for ${event.agent.name}`;
  },
};

const app = new BoringOS({});
app.contextProvider(myProvider);
```

### Adding a custom runtime

```typescript
const myRuntime: RuntimeModule = {
  type: "my-tool",
  async execute(ctx, callbacks) { /* spawn subprocess */ },
  async testEnvironment(config) { /* check availability */ },
  skillMarkdown() { return "Instructions for agents using this runtime"; },
};

const app = new BoringOS({});
app.runtime(myRuntime);
```

### Adding a custom workflow block handler

```typescript
const myHandler: BlockHandler = {
  types: ["send-email"],
  async execute(ctx) {
    const { to, subject, body } = ctx.config;
    // ... send the email
    return { output: { sent: true, to } };
  },
};

const app = new BoringOS({});
app.blockHandler(myHandler);
```

### Using memory

```typescript
import { BoringOS, createHebbsMemory } from "@boringos/core";

const app = new BoringOS({});
app.memory(createHebbsMemory({
  endpoint: "https://api.hebbs.ai",
  apiKey: "...",
}));
```

---

## Database

Uses `tenantId` throughout (not `companyId`). Multi-tenant by default.

Schema lives in `packages/@boringos/db/src/schema/`. ORM is Drizzle.

**To use external Postgres:**
```typescript
new BoringOS({ database: { url: "postgres://..." } });
```

**Embedded Postgres (default):** boots automatically, data stored in `.data/postgres`.

---

## Testing

Tests live in `tests/` at the repo root. Uses Vitest. Tests accumulate per phase.

```bash
pnpm test:run    # single pass (80 tests)
pnpm test        # watch mode
```

| File | Phase | Tests |
|---|---|---|
| `phase1-smoke.test.ts` | Package implementations | 21 |
| `phase2-smoke.test.ts` | Context providers + personas | 18 |
| `phase3-golden.test.ts` | Full agent execution e2e | 1 |
| `phase4-workflow.test.ts` | Workflow engine + DAG + handlers | 13 |
| `phase5-auth.test.ts` | JWT auth + callback API protection | 6 |
| `phase6-connectors.test.ts` | Connector SDK, Slack, Google, integration | 15 |
| `phase7-cli.test.ts` | CLI generator scaffolding | 4 |
| `phase8-ui.test.ts` | API client + list endpoints | 2 |

---

## Code Style

- TypeScript ESM (`"type": "module"`, `.js` imports for local files)
- `tenantId` everywhere (framework-agnostic multi-tenancy)
- Every component implements `SkillProvider` — ships `skillMarkdown()` alongside TypeScript API
- Convention over configuration — sensible defaults, minimal required config
- In-process by default, external services (Redis, Postgres) opt-in

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_URL` | (none) | External Postgres. If absent, embedded PG is used |

Memory (optional):
| `HEBBS_ENDPOINT` | (none) | Hebbs memory service URL |
| `HEBBS_API_KEY` | (none) | Hebbs API key |
| `HEBBS_WORKSPACE` | (none) | Hebbs workspace scoping |

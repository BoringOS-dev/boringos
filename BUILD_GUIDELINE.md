# BoringOS — Build Guideline

> For AI agents and developers building apps on BoringOS.
> Read CLAUDE.md first for framework overview, then this for "how to build."

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Your App                      │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │  Agents   │  │ Workflows│  │  Connectors   │ │
│  │(6 defined)│  │(DAG defs)│  │(Google, Slack)│ │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘ │
│       │              │                │          │
│  ┌────┴──────────────┴────────────────┴───────┐ │
│  │              BoringOS Core                  │ │
│  │  Agent Engine │ Workflow Engine │ Scheduler  │ │
│  │  Context Pipeline │ Callback API │ Admin API│ │
│  └────────────────────┬───────────────────────┘ │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐ │
│  │              Database (Postgres)            │ │
│  │  agents │ tasks │ workflows │ routines │ ...│ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │              Frontend (UI)                │   │
│  │  @boringos/ui hooks │ Your components     │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## How to Structure a BoringOS App

```
my-app/
├── src/
│   ├── index.ts                  # BoringOS app setup + registrations
│   ├── seed.ts                   # Seed data (agents, routines, workflows, goals)
│   ├── agents/                   # Agent definitions (name, role, instructions)
│   │   └── my-agent.ts
│   ├── context-providers/        # Custom context injected into agent runs
│   │   └── my-rules.ts
│   ├── block-handlers/           # Custom workflow block handlers
│   │   └── my-handler.ts
│   └── workflows/                # Workflow DAG definitions (blocks + edges)
│       └── my-workflow.ts
├── ui/                           # Frontend (Next.js, Vite, etc.)
│   └── src/
│       ├── app/                  # Pages
│       └── components/           # UI components
├── .env
└── package.json
```

---

## Entities — CRUD Patterns

Every entity in BoringOS follows the same pattern: **DB table → Admin API → UI page with list/create/edit/delete**.

### Available Entities

| Entity | DB Table | Admin API | UI Hook | Has CRUD |
|--------|----------|-----------|---------|----------|
| **Tenants** | `tenants` | `GET/POST /tenants` | — | Create only |
| **Agents** | `agents` | `GET/POST/PATCH /agents` | `useAgents()` | Full |
| **Tasks** | `tasks` | `GET/POST/PATCH/DELETE /tasks` | `useTasks()`, `useTask(id)` | Full |
| **Runs** | `agent_runs` | `GET /runs`, `POST /runs/:id/cancel` | `useRuns()` | Read + Cancel |
| **Routines** | `routines` | `GET/POST/PATCH/DELETE /routines` | — | Full |
| **Workflows** | `workflows` | Not yet (use DB directly) | — | Direct DB |
| **Goals** | `goals` | `GET/POST/PATCH /goals` | `useGoals()` | Full |
| **Projects** | `projects` | `GET/POST/PATCH /projects` | `useProjects()` | Full |
| **Labels** | `labels` | `GET/POST /labels`, `POST/DELETE /tasks/:id/labels/:labelId` | — | Full |
| **Approvals** | `approvals` | `GET /approvals`, `POST /approve`, `POST /reject` | `useApprovals()` | Read + Decide |
| **Runtimes** | `runtimes` | `GET/POST/PATCH/DELETE /runtimes` | `useRuntimes()` | Full |
| **Connectors** | `connectors` | `GET /connectors` | `useConnectors()` | Read only |
| **Inbox** | `inbox_items` | `GET /inbox`, `POST /archive`, `POST /create-task` | `useInbox()` | Read + Actions |
| **Budgets** | `budget_policies` | `GET/POST/DELETE /budgets` | — | Full |
| **Skills** | `company_skills` | `GET/POST /skills`, `POST/DELETE /skills/:id/attach/:agentId` | — | Full |
| **Plugins** | `plugins` | `GET /plugins`, `POST /plugins/:name/jobs/:job/trigger` | — | Read + Trigger |
| **Drive** | `drive_files` | `GET /drive/list`, `GET/PATCH /drive/skill` | — | Read + Edit |
| **Activity** | `activity_log` | `GET /activity` | — | Read only |

### Admin API Pattern

All admin endpoints:
- Base path: `/api/admin/*`
- Auth: `X-API-Key` header (configured via `auth.adminKey`)
- Tenant scoping: `X-Tenant-Id` header
- Both API key and session token (Bearer) are accepted

```bash
# List
curl GET /api/admin/agents -H "X-API-Key: ..." -H "X-Tenant-Id: ..."

# Create
curl POST /api/admin/agents -H "X-API-Key: ..." -H "X-Tenant-Id: ..." \
  -d '{"name": "...", "role": "...", "instructions": "..."}'

# Update
curl PATCH /api/admin/agents/:id -H "X-API-Key: ..." -H "X-Tenant-Id: ..." \
  -d '{"name": "new name"}'

# Delete
curl DELETE /api/admin/agents/:id -H "X-API-Key: ..." -H "X-Tenant-Id: ..."
```

---

## How to Define an Agent

Agents are the core of BoringOS. Each agent:
- Has a **name**, **role**, and **instructions** (markdown prompt)
- Is assigned a **runtime** (which CLI tool to use: claude, gemini, etc.)
- Runs as a **subprocess** — BoringOS spawns the CLI, passes context, reads output
- Communicates via the **callback API** using a JWT token

```typescript
// src/agents/my-agent.ts

export const myAgent = {
  name: "my-agent",
  role: "operations",          // Persona role (resolves to a persona bundle)
  title: "My Agent",           // Display name
  icon: "bot",                 // Lucide icon name
  instructions: `
You are My Agent. Here's what you do...

## Your Routine
1. Do X
2. Do Y
3. Create tasks for Z

## Memory Usage
- Remember patterns
- Recall past decisions
`,
};

export const myAgentRoutine = {
  title: "My Agent — Every hour",
  description: "Does something useful",
  cronExpression: "0 * * * *",      // Standard 5-field cron
  timezone: "UTC",
  priority: "medium" as const,       // urgent | high | medium | low
  concurrencyPolicy: "skip_if_active" as const,  // skip_if_active | coalesce_if_active | allow_concurrent
  catchUpPolicy: "skip_missed" as const,          // skip_missed | run_once | run_all
};
```

### Agent Instructions — What to Include

The instructions field is the agent's "brain." It's injected as system context when the agent runs. Include:

1. **Identity** — Who the agent is and its purpose
2. **Routine** — Step-by-step what to do on each run
3. **Classification rules** — How to categorize/prioritize things
4. **Output format** — What tasks/comments to create, how to structure them
5. **Memory usage** — What to remember, what to recall
6. **Edge cases** — What to skip, when to escalate

### Agent Callback API

When an agent runs, it gets `BORINGOS_CALLBACK_TOKEN` as an env var. Use it to:

```
GET    /api/agent/tasks/:taskId         — Read task + comments
PATCH  /api/agent/tasks/:taskId         — Update task status/title/description
POST   /api/agent/tasks                 — Create task (subtasks via parentId)
POST   /api/agent/tasks/:taskId/comments    — Post comment
POST   /api/agent/tasks/:taskId/work-products — Record deliverable
POST   /api/agent/runs/:runId/cost      — Report token usage
POST   /api/agent/agents                — Create another agent
```

---

## How to Define a Workflow

Workflows are DAGs (directed acyclic graphs) of blocks connected by edges. They execute without spawning an agent — unless a `wake-agent` block explicitly does so.

### Block Types (Built-in)

| Type | What it does | Config |
|------|-------------|--------|
| `trigger` | Entry point, passes config as output | `{}` |
| `condition` | Evaluates a condition, branches true/false | `{ field, operator, value }` |
| `delay` | Waits for a duration | `{ durationMs }` |
| `transform` | Maps data | `{ mappings: { key: value } }` |
| `wake-agent` | Wakes an agent | `{ agentId, reason?, taskId? }` |
| `connector-action` | Calls a connector action | `{ connectorKind, action, inputs? }` |

### Condition Operators

`equals`, `not_equals`, `contains`, `truthy`

### Template References

Block configs can reference prior block outputs using `{{blockName.field}}`:

```typescript
{
  id: "check",
  type: "condition",
  config: {
    field: "{{fetch-emails.success}}",  // References output of "fetch-emails" block
    operator: "equals",
    value: "true",
  },
}
```

### Workflow Definition Structure

```typescript
// src/workflows/my-workflow.ts
import type { BlockDefinition, EdgeDefinition } from "@boringos/workflow";

export const myWorkflow = {
  name: "My Workflow",
  type: "system" as const,    // "system" or "user"
  status: "active" as const,  // "draft" | "active" | "paused" | "archived"
};

export const myBlocks: BlockDefinition[] = [
  {
    id: "trigger",
    name: "trigger",
    type: "trigger",
    config: {},
    position: { x: 0, y: 0 },        // For visual editor
  },
  {
    id: "fetch",
    name: "fetch-data",
    type: "connector-action",
    config: {
      connectorKind: "google",
      action: "list_emails",
      inputs: { query: "is:unread newer_than:15m" },
    },
    position: { x: 250, y: 0 },
  },
  {
    id: "check",
    name: "has-data",
    type: "condition",
    config: {
      field: "{{fetch-data.success}}",
      operator: "equals",
      value: "true",
    },
    position: { x: 500, y: 0 },
  },
  {
    id: "wake",
    name: "wake-agent",
    type: "wake-agent",
    config: { agentId: "agent-id-here" },
    position: { x: 750, y: 0 },
  },
];

export const myEdges: EdgeDefinition[] = [
  { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
  { id: "e2", sourceBlockId: "fetch", targetBlockId: "check", sourceHandle: null, sortOrder: 0 },
  { id: "e3", sourceBlockId: "check", targetBlockId: "wake", sourceHandle: "condition-true", sortOrder: 0 },
  // condition-false: workflow ends — no agent spawned
];
```

### Branching

Condition blocks return `selectedHandle` (`"condition-true"` or `"condition-false"`). Only edges matching the handle are activated:

```
condition block
  ├── sourceHandle: "condition-true"  → block A (activated when true)
  ├── sourceHandle: "condition-false" → block B (activated when false)
  └── sourceHandle: null              → block C (always activated)
```

### Custom Block Handlers

```typescript
// src/block-handlers/my-handler.ts
import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "@boringos/workflow";

export const myHandler: BlockHandler = {
  types: ["my-block-type"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    // ctx.config — resolved block config (templates already substituted)
    // ctx.tenantId — current tenant
    // ctx.state — execution state (read prior block outputs)
    // ctx.services — service accessor (get db, memory, agentEngine, actionRunner)

    const db = ctx.services.get("db");
    const result = doSomething(ctx.config);

    return {
      output: { myField: result },           // Available to downstream blocks as {{blockName.myField}}
      selectedHandle: "my-branch",            // Optional: for branching (like condition-true/false)
    };
  },
};

// Register in index.ts:
app.blockHandler(myHandler);
```

### Available Services in Block Handlers

```typescript
ctx.services.get("db")                // Drizzle DB instance
ctx.services.get("memory")            // MemoryProvider (Hebbs)
ctx.services.get("drive")             // StorageBackend
ctx.services.get("agentEngine")       // AgentEngine (for wake-agent)
ctx.services.get("actionRunner")      // ActionRunner (for connector-action)
ctx.services.get("connectorRegistry") // ConnectorRegistry
```

---

## How to Define a Routine

Routines are cron-scheduled triggers. They can target an **agent** (direct wake) or a **workflow** (smart scheduling).

### Agent-Targeted Routine

```typescript
// Wakes the agent every hour — agent always runs
{
  title: "Hourly check",
  assigneeAgentId: "agent-id",
  cronExpression: "0 * * * *",
  concurrencyPolicy: "skip_if_active",
}
```

### Workflow-Triggered Routine (Recommended)

```typescript
// Runs a workflow every 15min — workflow decides if agent should wake
{
  title: "Smart email sync",
  workflowId: "workflow-id",          // ← targets workflow, not agent
  cronExpression: "*/15 * * * *",
  concurrencyPolicy: "skip_if_active",
}
```

**Why workflow-triggered?** The workflow does cheap checks (API calls, conditions) and only wakes the expensive agent when there's actual work. Saves ~75% on agent costs for routines that often find nothing.

### Cron Expression Reference

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *

Examples:
*/15 * * * *     Every 15 minutes
0 9 * * *        Daily at 9:00 AM
0 20 * * 0       Every Sunday at 8:00 PM
0 10 1 * *       1st of every month at 10:00 AM
```

---

## How to Add a Context Provider

Context providers inject information into the agent's prompt at runtime. They're sorted by phase and priority.

```typescript
// src/context-providers/my-rules.ts
import type { ContextProvider } from "@boringos/agent";

export const myRulesProvider: ContextProvider = {
  name: "my-rules",
  phase: "system",     // "system" (runs first) or "context" (runs after)
  priority: 20,        // Lower number = earlier in the phase

  async provide(event) {
    // Only inject for specific agents
    if (event.agent.name !== "my-agent") return null;

    return `## My Rules

Here are the rules for this agent...
- Rule 1
- Rule 2
`;
  },
};

// Register in index.ts:
app.contextProvider(myRulesProvider);
```

### Context Build Order

```
System phase (sorted by priority):
  1. header (priority 0) — framework name, version
  2. persona (priority 5) — agent's role persona
  3. tenant guidelines (priority 10) — tenant-specific rules
  4. your providers (priority 15-25) — custom rules
  5. agent instructions (priority 30) — the agent's instructions field
  6. execution protocol (priority 50) — callback API docs

Context phase (sorted by priority):
  1. session (priority 0) — prior session state
  2. task (priority 5) — assigned task details
  3. comments (priority 10) — task comments
  4. memory (priority 15) — recalled memories
  5. your providers — custom context data
  6. approval (priority 50) — pending approval details
```

---

## How to Add a Connector

Connectors integrate external services. They provide OAuth, events, and actions.

```typescript
// Already built:
import { google } from "@boringos/connector-google";   // Gmail + Calendar
import { slack } from "@boringos/connector-slack";       // Slack messaging

// Register in index.ts:
app.connector(google({ clientId: "...", clientSecret: "..." }));
app.connector(slack({ signingSecret: "..." }));
```

### Using Connector Actions from Agents

Agents call connector actions via the callback API or directly during execution. The `connector-action` workflow block handler also calls them.

### Using Connector Actions from Workflows

```typescript
{
  type: "connector-action",
  config: {
    connectorKind: "google",
    action: "list_emails",
    inputs: { query: "is:unread", maxResults: 20 },
  },
}
```

The handler fetches credentials from the DB automatically for the tenant.

---

## How to Build the UI

### Option A: Use @boringos/ui hooks (recommended)

The `@boringos/ui` package provides a typed API client and headless React hooks. No markup — you bring your own components.

```typescript
import { createBoringOSClient, BoringOSProvider, useAgents, useTasks } from "@boringos/ui";

const client = createBoringOSClient({
  url: "http://localhost:5001",
  apiKey: "your-admin-key",
  tenantId: "your-tenant-id",
});

// Wrap your app
<BoringOSProvider client={client}>
  <App />
</BoringOSProvider>

// Use hooks in components
function AgentList() {
  const { data: agents, loading } = useAgents();
  // render...
}
```

### Available Hooks

| Hook | Returns | Mutations |
|------|---------|-----------|
| `useAgents()` | agents list | `createAgent`, `wakeAgent` |
| `useTasks(filters?)` | tasks list | `createTask` |
| `useTask(taskId)` | task + comments | `updateTask`, `postComment`, `assignTask`, `addWorkProduct` |
| `useRuns(filters?)` | runs list (polls 5s) | `cancelRun` |
| `useRuntimes()` | runtimes list | `createRuntime`, `setDefault` |
| `useApprovals(status?)` | approvals list | `approve`, `reject` |
| `useConnectors()` | connector list | `invokeAction` |
| `useGoals()` | goals list | — |
| `useProjects()` | projects list | — |
| `useInbox()` | inbox items | — |
| `useSearch(query)` | search results | — |
| `useHealth()` | server status (polls 30s) | — |
| `useOnboarding()` | onboarding state | — |
| `useEvals()` | evaluations | — |
| `useEntityRefs()` | entity references | — |

### Option B: Direct API client (no React)

```typescript
import { createBoringOSClient } from "@boringos/ui";

const client = createBoringOSClient({ url: "...", apiKey: "...", tenantId: "..." });

// All methods return promises
const agents = await client.getAgents();
const task = await client.createTask({ title: "...", priority: "medium" });
await client.postComment(taskId, { body: "Done!" });

// SSE subscription
const unsubscribe = client.subscribe((event) => {
  console.log(event.type, event.data);
});
```

### UI Page Pattern

Each entity page follows this structure:

```
┌──────────────────────────────────────────────┐
│  Page Header                    [+ Add Button]│
│  Description text                             │
├──────────────────────────────────────────────┤
│  [Filter bar / Tabs / View toggle]            │
├──────────────────────────────────────────────┤
│                                               │
│  List / Board / Table                         │
│  ┌─────────────────────────────────────────┐ │
│  │ Item card / row                         │ │
│  │   Title          [Status badge] [Actions]│ │
│  │   Subtitle / metadata                   │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │ Item card / row                         │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  [Empty state when no items]                  │
│                                               │
└──────────────────────────────────────────────┘
```

### CRUD UI Pattern

**Create:** Button opens a modal or slide-over with a form. On submit, call `client.createX()` or `mutation.mutate()`.

**Read:** List page fetches via hook. Detail page fetches by ID. Both auto-refresh.

**Update:** Inline editing (click to edit) or edit modal. Status changes via dropdown.

**Delete:** Typically soft-delete (archive/cancel). Confirmation before destructive actions.

### CORS

If your frontend and backend run on different ports, use a proxy:

```javascript
// Next.js: next.config.js
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:5001/api/:path*" }];
  },
};

// Vite: vite.config.ts
export default {
  server: {
    proxy: {
      "/api": "http://localhost:5001",
      "/health": "http://localhost:5001",
    },
  },
};
```

Then use relative URLs in the client: `createBoringOSClient({ url: "" })`.

---

## How to Seed Data

The seed script creates initial entities via the Admin API after the server boots.

```typescript
// src/seed.ts
const BASE_URL = process.env.BASE_URL || "http://localhost:5001";
const ADMIN_KEY = process.env.ADMIN_KEY;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE_URL}/api/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": ADMIN_KEY,
      "X-Tenant-Id": TENANT_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Seed order matters (dependencies):
// 1. Tenant (everything else is tenant-scoped)
// 2. Runtime (agents need a runtime)
// 3. Agents (workflows reference agents, routines reference agents)
// 4. Workflows (routines reference workflows)
// 5. Routines (reference agents or workflows)
// 6. Labels, Goals, Projects (independent)
```

### For Workflows (No Admin API Yet)

Use the workflow store directly:

```typescript
import { createWorkflowStore } from "@boringos/workflow";
import { createDatabase } from "@boringos/db";

const dbConn = await createDatabase({ url: DATABASE_URL });
const store = createWorkflowStore(dbConn.db);

const wf = await store.create({
  tenantId: TENANT_ID,
  name: "My Workflow",
  type: "system",
  blocks: myBlocks,
  edges: myEdges,
});
// wf.id is the workflow ID — use it for workflowId on routines

await dbConn.close();
```

---

## How to Register Everything in index.ts

```typescript
import { BoringOS, createHebbsMemory } from "@boringos/core";
import { google } from "@boringos/connector-google";

const app = new BoringOS({
  auth: { secret: "...", adminKey: "..." },
  database: { url: "postgres://..." },    // or { embedded: true }
  drive: { root: ".data/drive" },
});

// 1. Memory (optional)
app.memory(createHebbsMemory({ endpoint: "...", apiKey: "..." }));

// 2. Connectors
app.connector(google({ clientId: "...", clientSecret: "..." }));

// 3. Queue (optional — default: in-process)
// app.queue(createBullMQQueue({ redis: "redis://..." }));

// 4. Context providers
app.contextProvider(myRulesProvider);

// 5. Block handlers
app.blockHandler(myCustomHandler);

// 6. Inbox routing
app.routeToInbox({
  filter: (event) => event.type === "email_received",
  transform: (event) => ({ subject: event.data.subject, body: event.data.snippet, source: "gmail" }),
});

// 7. Custom routes (Hono)
app.route("/my-endpoint", myHonoApp);

// 8. Lifecycle hooks
app.beforeStart(async (ctx) => { /* ctx.db is available here */ });
app.afterStart(async (ctx) => { /* server is listening */ });

// 9. Start
app.listen(5001);
```

### Builder Methods (all return `this` for chaining)

| Method | What it does |
|--------|-------------|
| `.memory(provider)` | Set memory provider (Hebbs or null) |
| `.runtime(module)` | Register additional runtime |
| `.contextProvider(provider)` | Add custom context provider |
| `.persona(role, bundle)` | Register custom persona |
| `.connector(definition)` | Register connector (Google, Slack, etc.) |
| `.queue(adapter)` | Set job queue (default: in-process, opt-in: BullMQ) |
| `.blockHandler(handler)` | Register custom workflow block handler |
| `.plugin(manifest)` | Register plugin |
| `.schema(ddl)` | Add custom DB tables (DDL runs after migrations) |
| `.routeToInbox(config)` | Route connector events to inbox |
| `.route(path, app)` | Mount custom Hono routes |
| `.beforeStart(fn)` / `.afterStart(fn)` / `.beforeShutdown(fn)` | Lifecycle hooks |
| `.listen(port?)` | Boot and start HTTP server |

---

## Common Patterns

### Pattern: Workflow-Triggered Routine (Smart Scheduling)

Don't wake an agent just to check "anything new?" Use a workflow:

```
Routine (cron) → Workflow:
  trigger → connector-action(check for new data)
    → condition(has data?)
      → true: wake-agent(process it)
      → false: done ($0)
```

### Pattern: Agent Creates Subtasks

An agent can break its work into subtasks via the callback API:

```
Agent wakes → reads main task → creates subtasks (POST /api/agent/tasks with parentId)
  → marks main task as in_progress → works on subtasks → marks them done
```

### Pattern: Event → Inbox → Agent

External events flow through the inbox for user visibility:

```
Connector event → routeToInbox() → inbox item (user sees it)
                → also triggers workflow → wake-agent if needed
```

### Pattern: Memory Continuity

Agents use memory to learn across sessions:

```
Session 1: Agent processes emails, remembers "client X always sends urgent requests"
Session 2: Agent recalls this pattern, auto-classifies client X's emails as urgent
```

---

## Environment Variables

```env
# Required
ADMIN_KEY=your-admin-key           # Admin API authentication
AUTH_SECRET=your-jwt-secret         # JWT signing for callback tokens

# Database
DATABASE_URL=postgres://...         # External Postgres (omit for embedded)

# Google OAuth (for Gmail + Calendar)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Memory (optional)
HEBBS_ENDPOINT=https://di.hebbs.ai/
HEBBS_API_KEY=...
HEBBS_WORKSPACE=my-app

# Queue (optional — for production)
REDIS_URL=redis://localhost:6379

# Notifications (optional)
RESEND_API_KEY=...
```

---

## Testing

```bash
pnpm test:run    # Run all tests (118 tests)
pnpm test        # Watch mode
```

Test files live in `tests/` at the repo root. Use Vitest. Each test file covers a phase/feature. Tests boot embedded Postgres instances in temp dirs.

---

## Quick Reference: What Goes Where

| I want to... | Create/modify... |
|-------------|-----------------|
| Add a new agent | `src/agents/my-agent.ts` + register in seed |
| Add agent instructions | `instructions` field in agent definition |
| Schedule an agent | Create a routine in seed (agent or workflow target) |
| Add a workflow | `src/workflows/my-workflow.ts` + create via store in seed |
| Add a workflow block type | `src/block-handlers/my-handler.ts` + `app.blockHandler()` |
| Inject context into agents | `src/context-providers/my-provider.ts` + `app.contextProvider()` |
| Connect an external service | `app.connector(...)` in index.ts |
| Route events to inbox | `app.routeToInbox(...)` in index.ts |
| Add a custom API endpoint | `app.route("/path", honoApp)` in index.ts |
| Add a UI page | `ui/src/app/my-page/page.tsx` + add to sidebar |
| Create seed data | `src/seed.ts` — call admin API |
| Add custom DB tables | `app.schema("CREATE TABLE ...")` in index.ts |

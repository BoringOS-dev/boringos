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

## UI Implementation — Entity Pages (Add / Edit / Delete)

Every entity needs a full CRUD page. Below are concrete implementation patterns for each.

### Standard Page Template

Every entity page has three parts: **list view**, **create modal**, **detail/edit view**.

```
┌──────────────────────────────────────────────────────────┐
│  Entity Name                               [+ Add Button]│
│  Description                                              │
├──────────────────────────────────────────────────────────┤
│  [Filters] [View Toggle: List | Board | Grid]             │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐│
│  │ Item Row                                             ││
│  │  Name / Title        [Status Badge]  [Edit] [Delete] ││
│  │  Subtitle / metadata                                 ││
│  └──────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────┐│
│  │ ...more items                                        ││
│  └──────────────────────────────────────────────────────┘│
│                                                           │
│  [Empty State: icon + message + CTA when no items]        │
└──────────────────────────────────────────────────────────┘
```

### Create Modal Pattern

```tsx
"use client";
import { useState } from "react";
import { useClient } from "@boringos/ui";

function CreateEntityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const client = useClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    try {
      await client.createAgent({ name, role: "engineer" }); // or whatever entity
      onCreated(); // parent refetches the list
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl bg-[var(--bg)] border border-[var(--border)] shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">Create Entity</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)]">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
          </div>
          {/* More fields... */}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-lg disabled:opacity-50">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Inline Edit Pattern

For status changes, titles, and other quick edits — use inline editing, not a modal:

```tsx
function EditableField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return <span onClick={() => { setEditing(true); setDraft(value); }}
      className="cursor-pointer hover:bg-[var(--bg-secondary)] px-1 rounded">{value}</span>;
  }

  return (
    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onSave(draft); setEditing(false); }}
      onKeyDown={(e) => { if (e.key === "Enter") { onSave(draft); setEditing(false); }
        if (e.key === "Escape") setEditing(false); }}
      className="px-1 border-b border-[var(--accent)] outline-none bg-transparent" />
  );
}
```

### Delete with Confirmation Pattern

```tsx
function DeleteButton({ onDelete, label = "Delete" }: { onDelete: () => void; label?: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return <button onClick={() => setConfirming(true)}
      className="text-xs text-red-500 hover:text-red-700">{label}</button>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-600">Are you sure?</span>
      <button onClick={() => { onDelete(); setConfirming(false); }}
        className="text-xs px-2 py-0.5 bg-red-500 text-white rounded">Yes</button>
      <button onClick={() => setConfirming(false)}
        className="text-xs text-[var(--text-secondary)]">No</button>
    </div>
  );
}
```

---

### Entity: Agents — Full CRUD

**List** (`/agents`):
- Grid of agent cards showing: name, role, status, last run time, run count
- Filter by status (idle / running / paused / error)
- [+ New Agent] button opens create modal
- Each card has: [Wake] button, [Edit] link, status badge

**Create Modal** — fields:
- `name` (required) — agent identifier
- `role` — dropdown: operations, engineer, researcher, writer, or custom
- `title` — display name
- `instructions` — textarea (markdown, expandable)
- `runtimeId` — dropdown of available runtimes

**Detail/Edit** (`/agents/:id`):
- Editable inline: name, title, instructions (click to edit)
- Status dropdown: idle → paused → archived
- Runtime picker
- Run history table with status badges
- [Wake Agent] button — calls `POST /api/admin/agents/:id/wake`
- [Pause] / [Archive] buttons with confirmation

**API calls:**
```typescript
// List
const agents = await client.getAgents();
// Create
await client.createAgent({ name, role, instructions, runtimeId });
// Update
await client.updateAgent(agentId, { name, instructions, status });
// Wake
await client.wakeAgent(agentId);
// Delete (archive)
await client.updateAgent(agentId, { status: "archived" });
```

---

### Entity: Tasks — Full CRUD

**List** (`/tasks`):
- View toggle: List | Board (kanban by status)
- Filter by: status, label, assignee, priority
- [+ New Task] button
- Each row shows: identifier (BOS-001), title, priority badge, status badge, assignee

**Board view** — 3 columns:
- To Do (backlog + todo)
- In Progress (in_progress + in_review)
- Done (done)

**Create Modal** — fields:
- `title` (required)
- `description` — textarea
- `priority` — dropdown: urgent / high / medium / low
- `status` — dropdown: backlog / todo
- `assigneeAgentId` — dropdown of agents
- `parentId` — optional, for subtasks
- `labels` — multi-select

**Detail** (`/tasks/:id`):
- Editable inline: title, description, status, priority
- Tabs: Comments | Work Products | Subtasks
- Comment thread with add comment form
- [Assign to Agent] dropdown + [Wake Agent] button
- [Delete] with confirmation

**API calls:**
```typescript
const tasks = await client.getTasks({ status: "todo" });
await client.createTask({ title, description, priority, assigneeAgentId, parentId });
await client.updateTask(taskId, { status: "done", title: "Updated" });
await client.postComment(taskId, { body: "Done!" });
await client.addWorkProduct(taskId, { kind: "document", title: "Report", url: "/drive/report.md" });
await client.deleteTask(taskId);
```

---

### Entity: Workflows — Visual Builder

Workflows need a richer UI than simple CRUD. They need a **visual DAG editor**.

**List** (`/workflows`):
- Card per workflow showing: name, status, block count, block flow preview
- Block flow preview: horizontal chain of colored pills (trigger → action → condition → ...)
- [+ New Workflow] button
- Each card: [Edit] opens visual editor, [Pause/Archive] status toggle, [Delete]

**Visual Block Flow** — show blocks as a pipeline:
```tsx
function BlockFlow({ blocks }: { blocks: BlockDefinition[] }) {
  const colorMap: Record<string, string> = {
    trigger: "bg-green-50 border-green-200 text-green-700",
    condition: "bg-yellow-50 border-yellow-200 text-yellow-700",
    "wake-agent": "bg-purple-50 border-purple-200 text-purple-700",
    "connector-action": "bg-blue-50 border-blue-200 text-blue-700",
    transform: "bg-gray-50 border-gray-200 text-gray-700",
    delay: "bg-orange-50 border-orange-200 text-orange-700",
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {blocks.map((block, i) => (
        <div key={block.id} className="flex items-center gap-2">
          <div className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${colorMap[block.type] || colorMap.transform}`}>
            {block.type}: {block.name}
          </div>
          {i < blocks.length - 1 && <span className="text-gray-400">→</span>}
        </div>
      ))}
    </div>
  );
}
```

**Visual Editor** (advanced — for full builder):
- Use `@xyflow/react` (React Flow) for drag-and-drop DAG editing
- Left panel: block palette (draggable block types)
- Center: canvas with nodes and edges
- Right panel: block config form (changes based on selected block type)
- Each node shows: block type icon, name, config summary
- Edges show: handle labels for branching (condition-true / condition-false)

**Block Palette:**
```tsx
const BLOCK_TYPES = [
  { type: "trigger", label: "Trigger", icon: Play, color: "green", description: "Entry point" },
  { type: "connector-action", label: "Connector Action", icon: Plug, color: "blue", description: "Call external API" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "yellow", description: "Branch on condition" },
  { type: "wake-agent", label: "Wake Agent", icon: Bot, color: "purple", description: "Spawn an agent" },
  { type: "transform", label: "Transform", icon: ArrowRight, color: "gray", description: "Map data" },
  { type: "delay", label: "Delay", icon: Clock, color: "orange", description: "Wait" },
];
```

**Block Config Panel** — changes based on type:
```tsx
function BlockConfigPanel({ block, onUpdate }: { block: BlockDefinition; onUpdate: (config: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "connector-action":
      return (
        <div className="space-y-3">
          <SelectField label="Connector" value={block.config.connectorKind}
            options={["google", "slack"]} onChange={(v) => onUpdate({ ...block.config, connectorKind: v })} />
          <SelectField label="Action" value={block.config.action}
            options={getActionsForConnector(block.config.connectorKind)}
            onChange={(v) => onUpdate({ ...block.config, action: v })} />
          <JsonField label="Inputs" value={block.config.inputs}
            onChange={(v) => onUpdate({ ...block.config, inputs: v })} />
        </div>
      );
    case "condition":
      return (
        <div className="space-y-3">
          <TextField label="Field" value={block.config.field} placeholder="{{blockName.field}}"
            onChange={(v) => onUpdate({ ...block.config, field: v })} />
          <SelectField label="Operator" value={block.config.operator}
            options={["equals", "not_equals", "contains", "truthy"]}
            onChange={(v) => onUpdate({ ...block.config, operator: v })} />
          <TextField label="Value" value={block.config.value}
            onChange={(v) => onUpdate({ ...block.config, value: v })} />
        </div>
      );
    case "wake-agent":
      return (
        <div className="space-y-3">
          <AgentPicker label="Agent" value={block.config.agentId}
            onChange={(v) => onUpdate({ ...block.config, agentId: v })} />
          <TextField label="Reason" value={block.config.reason} placeholder="workflow_triggered"
            onChange={(v) => onUpdate({ ...block.config, reason: v })} />
        </div>
      );
    // ... other block types
  }
}
```

**Connector "Connected" Status** — show which connectors have stored credentials:

```tsx
function ConnectorStatus({ kind }: { kind: string }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Check if connector has stored credentials by querying the connectors table
    // The /api/connectors/connectors endpoint shows hasOAuth but not credential status.
    // Add a custom endpoint or check localStorage after OAuth callback.
    fetch(`/api/connectors/${kind}/status`)
      .then(r => r.json())
      .then(data => setConnected(data.hasCredentials))
      .catch(() => {});
  }, [kind]);

  return connected
    ? <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Connected</span>
    : <a href={`/api/connectors/${kind}/oauth/authorize`}
        className="text-xs px-2 py-1 bg-blue-500 text-white rounded">Connect</a>;
}
```

---

### Entity: Routines — CRUD with Schedule Preview

**List** (`/routines`):
- Table showing: title, schedule (cron expression in human-readable), target (agent name or workflow name), status, last triggered
- [+ New Routine] button
- Each row: [Edit] opens modal, [Trigger Now] button, [Pause/Delete]
- Badge showing "workflow" or "agent" to distinguish target type

**Create/Edit Modal** — fields:
- `title` (required)
- `description`
- Target type toggle: **Agent** | **Workflow**
  - If Agent: `assigneeAgentId` — agent dropdown
  - If Workflow: `workflowId` — workflow dropdown
- `cronExpression` — input with live preview ("Every 15 minutes", "Daily at 9 AM")
- `timezone` — timezone picker
- `concurrencyPolicy` — dropdown: skip_if_active / coalesce_if_active / allow_concurrent

**Cron Preview Helper:**
```tsx
function CronPreview({ expression }: { expression: string }) {
  const descriptions: Record<string, string> = {
    "*/15 * * * *": "Every 15 minutes",
    "0 * * * *": "Every hour",
    "0 9 * * *": "Daily at 9:00 AM",
    "0 20 * * 0": "Every Sunday at 8:00 PM",
    "0 10 1 * *": "1st of every month at 10:00 AM",
  };
  const desc = descriptions[expression] || expression;
  return <span className="text-xs text-[var(--text-secondary)] font-mono">{desc}</span>;
}
```

**API calls:**
```bash
# List
GET /api/admin/routines

# Create (agent-targeted)
POST /api/admin/routines
{ "title": "...", "assigneeAgentId": "...", "cronExpression": "*/15 * * * *" }

# Create (workflow-triggered)
POST /api/admin/routines
{ "title": "...", "workflowId": "...", "cronExpression": "*/15 * * * *" }

# Update
PATCH /api/admin/routines/:id
{ "status": "paused", "cronExpression": "0 * * * *" }

# Manual trigger
POST /api/admin/routines/:id/trigger

# Delete
DELETE /api/admin/routines/:id
```

---

### Entity: Goals — Hierarchical View

**List** (`/goals`):
- Cards showing: title, status (planned/active/done/dropped), description
- Progress indicator (% of linked monthly tasks completed)
- [+ New Goal] button
- Each card: [Edit] inline, [Mark Done/Drop] status buttons

**Hierarchy drill-down:**
```
Quarterly Goal (Goals API)
  └── Monthly Objectives (Tasks, label: monthly) — show as nested list
       └── Weekly Objectives (Tasks, label: weekly)
            └── Daily Tasks (Tasks, label: daily)
```

**API calls:**
```bash
GET /api/admin/goals
POST /api/admin/goals { "title": "Q2: Grow revenue", "status": "active" }
PATCH /api/admin/goals/:id { "status": "done" }
```

---

### Entity: Inbox — Triage View

**List** (`/inbox`):
- Filter tabs: All | Unread | Archived
- Each item shows: source badge (gmail, slack), subject, body preview, timestamp
- Unread items have a left border accent
- Actions per item: [Create Task] [Archive] [Mark Read]
- [Create Task] converts inbox item to a task with pre-filled fields

**API calls:**
```bash
GET /api/admin/inbox
GET /api/admin/inbox/:id           # marks as read
POST /api/admin/inbox/:id/archive
POST /api/admin/inbox/:id/create-task
```

---

### Entity: Connectors — Connection Status

**List** (`/settings` or `/connectors`):
- Card per registered connector
- Shows: name, description, available actions, available events
- **Connection status:**
  - No credentials → [Connect] button (links to OAuth authorize)
  - Has credentials → "Connected" badge + [Reconnect] button
  - OAuth error → "Error" badge + [Reconnect]
- Show available actions as chips: `list_emails`, `send_email`, `list_events`, ...

**How to check connection status:**

The `/api/connectors/connectors` endpoint returns `hasOAuth: true` but doesn't say if credentials are stored. Options:

1. **After OAuth callback** — redirect to `?connected=true`, save flag in localStorage
2. **Custom endpoint** — query the `connectors` DB table for the tenant
3. **Try an action** — call a lightweight action and check if it succeeds

Recommended: option 2 — add a custom endpoint:
```typescript
// In your app's beforeStart hook:
app.route("/api/connectors/:kind/status", new Hono().get("/", async (c) => {
  const kind = c.req.param("kind");
  const rows = await ctx.db.select().from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, kind))).limit(1);
  return c.json({ hasCredentials: rows.length > 0 && !!rows[0].credentials });
}));
```

---

### Entity: Runtimes — Configuration

**List** (in `/settings` or `/runtimes`):
- Table: name, type (claude/gemini/ollama/command), model, default badge
- [+ Add Runtime] button
- Each row: [Set Default] button, [Edit] modal, [Delete] with confirmation

**Create/Edit Modal** — fields:
- `name` — display name
- `type` — dropdown: claude, chatgpt, gemini, ollama, command, webhook
- `config` — JSON editor (runtime-specific: model, args, environment vars)
- `model` — text input (e.g., "claude-sonnet-4-5", "gpt-4o")

**API calls:**
```bash
GET /api/admin/runtimes
POST /api/admin/runtimes { "name": "Claude", "type": "claude", "config": {} }
PATCH /api/admin/runtimes/:id { "name": "Claude Fast", "config": { "model": "claude-sonnet-4-5" } }
POST /api/admin/runtimes/:id/default   # Set as default
DELETE /api/admin/runtimes/:id
```

---

### Entity: Labels — Simple CRUD

**List** (in `/settings` or inline on tasks page):
- Color dot + name for each label
- [+ Add Label] inline form
- Each label: [Edit] (name + color picker), [Delete]

**API calls:**
```bash
GET /api/admin/labels
POST /api/admin/labels { "name": "urgent", "color": "#DC2626" }
# Attach/detach from tasks:
POST /api/admin/tasks/:taskId/labels/:labelId
DELETE /api/admin/tasks/:taskId/labels/:labelId
```

---

### Entity: Projects — Task Organization

**List** (`/projects`):
- Card per project: name, task prefix (e.g., "ALPHA"), task count, repo URL
- [+ New Project] modal
- Each card links to filtered task list

**Create/Edit Modal** — fields:
- `name` — project name
- `repoUrl` — optional git repository URL
- `defaultBranch` — e.g., "main"
- `branchTemplate` — e.g., "feat/{{identifier}}-{{slug}}"

**API calls:**
```bash
GET /api/admin/projects
POST /api/admin/projects { "name": "Alpha", "repoUrl": "https://github.com/..." }
PATCH /api/admin/projects/:id { "name": "Alpha v2" }
```

---

### Entity: Approvals — Decision Queue

**List** (`/approvals`):
- Filter tabs: Pending | Approved | Rejected
- Each item: type, requester (agent), payload summary, timestamp
- Pending items have: [Approve] and [Reject] buttons with optional note field

**API calls:**
```bash
GET /api/admin/approvals?status=pending
POST /api/admin/approvals/:id/approve { "note": "Looks good" }
POST /api/admin/approvals/:id/reject { "reason": "Too expensive" }
```

---

### Entity: Budgets — Policy Management

**List** (in `/settings` or `/budgets`):
- Table: scope (tenant/agent), period (daily/weekly/monthly), limit, warn threshold, current spend
- Progress bar showing spend vs limit (yellow at warn, red at limit)
- [+ Add Budget Policy] modal
- [Delete] per policy
- Incidents section: list of hard_stop and warning events

**API calls:**
```bash
GET /api/admin/budgets
POST /api/admin/budgets { "scope": "agent", "agentId": "...", "period": "monthly", "limitCents": 10000, "warnThresholdCents": 8000 }
DELETE /api/admin/budgets/:id
GET /api/admin/budgets/incidents
```

---

### Entity: Drive — File Browser

**View** (`/drive`):
- Tree/list view of files in the drive
- Breadcrumb navigation
- Upload zone (drag & drop)
- File preview for markdown/text
- Skill file editor with revision history

**API calls:**
```bash
GET /api/admin/drive/list?prefix=/finance/2026/
GET /api/admin/drive/skill
PATCH /api/admin/drive/skill { "content": "..." }
GET /api/admin/drive/skill/revisions
```

---

### Entity: Activity Log — Audit Trail

**View** (`/activity` or in settings):
- Reverse-chronological list of all admin mutations
- Each entry: action, entity type, entity ID, timestamp, actor
- Filter by action type or entity type

**API calls:**
```bash
GET /api/admin/activity?limit=50&offset=0
```

---

## Sidebar Navigation Order

Recommended sidebar structure:

```tsx
const nav = [
  // Core
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },

  // Planning
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/projects", label: "Projects", icon: FolderKanban },

  // Automation
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workflows", label: "Workflows", icon: GitBranch },
  { href: "/routines", label: "Routines", icon: Clock },

  // Data
  { href: "/drive", label: "Drive", icon: HardDrive },
  { href: "/connectors", label: "Connectors", icon: Plug },

  // System
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

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

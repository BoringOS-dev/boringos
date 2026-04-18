# BoringOS — Build Guideline

> For AI agents and developers building apps on BoringOS.
> Read CLAUDE.md first for framework overview, then this for "how to build."

---

## 5-Minute Quickstart

```bash
npx create-boringos my-app        # scaffolds a minimal project
cd my-app
cp .env.example .env              # fill in ADMIN_KEY
npm install && npm run dev         # boots with embedded Postgres on :3000
```

That gives you: health endpoint, admin API, agent callback API, embedded Postgres, in-process queue. No Redis, no external DB, no config needed.

To add agents, create them via the admin API:
```bash
curl -X POST http://localhost:3000/api/admin/agents \
  -H "X-API-Key: your-admin-key" -H "X-Tenant-Id: your-tenant-id" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "role": "engineer", "instructions": "You help with code."}'
```

Or use a team template to create a full team in one call:
```bash
curl -X POST http://localhost:3000/api/admin/teams/from-template \
  -H "X-API-Key: your-admin-key" -H "X-Tenant-Id: your-tenant-id" \
  -H "Content-Type: application/json" \
  -d '{"template": "engineering"}'
# Creates: CTO + 2 Engineers + QA, hierarchy wired automatically
```

---

## Tenant Provisioning (Automatic)

**The framework now handles tenant provisioning automatically.** When a user signs up with `tenantName`, the framework:

1. Creates the tenant
2. Seeds 6 runtimes (claude, chatgpt, gemini, ollama, command, webhook)
3. Creates the copilot agent for the tenant

Apps **do not** need to manually create runtimes or copilot agents. This happens automatically on signup.

### App-specific tenant setup

If your app needs to create domain-specific data when a new tenant is created (e.g., seed default agents, workflows, sample data), use the `onTenantCreated` hook:

```typescript
app.onTenantCreated(async (db, tenantId) => {
  // Create app-specific agents, seed data, etc.
  await createAgentFromTemplate(db, "engineer", {
    tenantId,
    name: "Lead Qualifier",
    runtimeId: (await db.select().from(runtimes)
      .where(eq(runtimes.tenantId, tenantId)).limit(1))[0]?.id,
  });
});
```

The hook runs after runtimes and copilot are already provisioned, so you can reference them.

### Signup flow

Signup now supports multi-tenant SaaS out of the box:

- **New tenant:** `POST /api/auth/signup` with `tenantName` — creates tenant + provisions everything + returns session
- **Join existing tenant:** `POST /api/auth/signup` with `inviteCode` — joins the tenant from the invitation
- **Legacy:** `POST /api/auth/signup` with `tenantId` — joins an existing tenant directly (for backward compatibility)

### Invitations

Admins can invite users to their tenant:

```bash
# Create invite (admin only)
POST /api/auth/invite { "email": "bob@acme.com", "role": "member" }
→ { id, inviteCode, expiresAt }  # 7-day expiry

# List pending invites
GET /api/auth/invitations

# Revoke an invite
DELETE /api/auth/invitations/:id
```

New users sign up with the `inviteCode` to join the tenant.

### Team management

Admins can manage users within their tenant:

```bash
# List team members
GET /api/auth/team

# Change a user's role (admin only)
PATCH /api/auth/team/:userId/role { "role": "admin" }

# Remove a user (admin only)
DELETE /api/auth/team/:userId
```

---

## Build Thesis: The Framework Orchestrates, The CLI Thinks

**BoringOS never calls an LLM API.** It spawns CLI agents that think for themselves.

Most "AI products" work like this:
```
User action → Your backend → anthropic.messages.create() → Parse JSON → Show result
```

You write prompt engineering code, manage tool schemas, parse structured output, handle retries. The intelligence is scattered across your codebase.

BoringOS works like this:
```
User action → Create task → Wake agent → CLI spawns with full context
                                          → CLI reasons autonomously
                                          → CLI calls back with results
                                          → Framework persists → UI updates
```

The difference is fundamental:

| | Traditional AI App | BoringOS App |
|---|---|---|
| **Intelligence lives in** | Your backend code (prompts, parsers, chains) | CLI subprocess (Claude Code, Codex, Gemini CLI) |
| **Your code does** | Prompt engineering, response parsing, tool schemas | Task creation, agent wake, context assembly |
| **LLM interaction** | API calls you manage | CLI handles it — you never see it |
| **Tool use** | You define tool schemas, handle calls | CLI has native tool use (file access, code execution, web) |
| **Complexity scales with** | Every new feature needs new prompts + parsers | Every new feature needs a context provider + agent config |

### What This Means for App Developers

**You never write AI code.** You write:

1. **Context providers** — teach agents about your domain (CRM schema, user role, page context)
2. **Agent definitions** — name, role, instructions, trigger conditions
3. **Task creation logic** — when to wake an agent (new inbox item, daily routine, user request)

The agent CLI handles reasoning, tool use, multi-step planning, error recovery, and code execution. Your app just creates the task and reads the result.

### The Runtime Model

An agent "run" works like this:

```
1. WAKE       — Something triggers the agent (comment, routine, event, manual)
2. QUEUE      — Request coalesced + queued (prevents duplicate runs)
3. CONTEXT    — Context pipeline assembles: system instructions + task + comments
                + memory + domain knowledge from your context providers
4. SPAWN      — Runtime spawns CLI subprocess (e.g., Claude Code)
                CLI receives: system prompt, callback URL + JWT token, workspace path
5. EXECUTE    — CLI runs autonomously — reads files, writes code, calls tools
                CLI calls back to framework via JWT-authenticated HTTP:
                  POST /tasks/:id/comments  (post updates)
                  POST /work-products       (record deliverables)
                  POST /costs               (report token usage)
6. COMPLETE   — Framework records result, updates task status, emits events
```

The CLI is a real process with real file access. It's not a chat completion — it's an autonomous agent that can read your codebase, run tests, make HTTP calls, and report back.

### Runtimes Are Swappable

Same agent can run on different runtimes:
- **Claude** — Claude Code CLI (`--dangerously-skip-permissions` for autonomous execution)
- **ChatGPT** — Codex CLI
- **Gemini** — Gemini CLI
- **Ollama** — Local models
- **Command** — Any shell command
- **Webhook** — External HTTP endpoint

The agent definition doesn't change. Just swap the runtime. This means you can run cheap tasks on Ollama and important tasks on Claude without changing any app code.

### Implications for Product Design

When building features on BoringOS:

**Don't build algorithms. Configure agents.**
- ❌ Write a lead scoring formula with weighted factors
- ✅ Create a Lead Qualifier agent with scoring criteria in its instructions

**Don't parse LLM output. Create tasks.**
- ❌ `const response = await anthropic.messages.create(...)` then parse JSON
- ✅ Create a task, wake the agent, read the work product when it's done

**Don't engineer prompts in your backend. Write context providers.**
- ❌ Build a prompt string with template literals and conditionals
- ✅ Register a context provider that returns domain knowledge as markdown

**Don't build "AI features." Build agent awareness.**
- ❌ "AI-powered deal insights" = custom endpoint with prompt + API call
- ✅ Give the copilot a `crm-deal-context` provider, it figures out insights itself

The intelligence isn't in your code. It's in the CLI. Your job is to give it the right context and the right tasks.

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
| **Inbox** | `inbox_items` | `GET /inbox` (filter by `assigneeUserId`, supports `=me`), `POST /archive`, `POST /create-task` | `useInbox()` | Read + Actions |
| **Budgets** | `budget_policies` | `GET/POST/DELETE /budgets` | — | Full |
| **Skills** | `company_skills` | `GET/POST /skills`, `POST/DELETE /skills/:id/attach/:agentId` | — | Full |
| **Plugins** | `plugins` | `GET /plugins`, `POST /plugins/:name/jobs/:job/trigger` | — | Read + Trigger |
| **Drive** | `drive_files` | `GET /drive/list`, `GET/PATCH /drive/skill` | — | Read + Edit |
| **Activity** | `activity_log` | `GET /activity` | — | Read only |
| **Settings** | `tenant_settings` | `GET/PATCH /settings` | `useSettings()` | Read + Update |

### Admin API Pattern

All admin endpoints:
- Base path: `/api/admin/*`
- Auth: `X-API-Key` header (configured via `auth.adminKey`)
- Tenant scoping: `X-Tenant-Id` header
- Both API key and session token (Bearer) are accepted
- Session auth sets `userId`, `tenantId`, and `role` on the request context

### Exportable Auth Middleware

For your own custom routes, use the framework's auth middleware instead of reimplementing session resolution:

```typescript
import { createAuthMiddleware } from "@boringos/core";

const authMiddleware = createAuthMiddleware(db);

// Mount on your custom routes
app.route("/api/myapp", myAppRoutes);
// In myAppRoutes, use authMiddleware — it resolves session → sets X-Tenant-Id, X-User-Id, X-User-Role headers
```

This gives your routes the same `userId`, `tenantId`, and `role` that the admin API has, without reimplementing session token parsing.

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

# Settings (key-value tenant config)
curl GET /api/admin/settings -H "X-API-Key: ..." -H "X-Tenant-Id: ..."
curl PATCH /api/admin/settings -H "X-API-Key: ..." -H "X-Tenant-Id: ..." \
  -d '{"agents_paused": "true"}'

# Runtime model catalog
curl GET /api/admin/runtimes/:id/models -H "X-API-Key: ..." -H "X-Tenant-Id: ..."
```

### Agent Pause / Kill Switch

Two levels of pause:

1. **Global pause** — set `agents_paused` to `"true"` via `PATCH /settings`. Engine checks this before every run and returns status `"skipped"` with `errorCode: "agents_paused"`.
2. **Per-agent pause** — set agent `status` to `"paused"` via `PATCH /agents/:id`. Engine skips with `errorCode: "agent_paused"`.

Both are checked before budget check. Runs get `status: "skipped"` (not `"failed"`) so they're distinguishable.

### Runtime Model Sync

When `PATCH /runtimes/:id` receives a `model` value, it auto-syncs into `config.model` (and vice versa). This ensures the CLI always receives `--model` and the display column stays consistent.

`GET /runtimes/:id/models` returns the available model catalog for that runtime type (static list or dynamic via `listModels()`).

### Task Cost Enrichment

`GET /tasks/:id` now returns `runs` and `costSummary` alongside `task`, `comments`, and `workProducts`. Each run includes `model`, `inputTokens`, `outputTokens`, `costUsd`, agent name, status, and duration. The `costSummary` aggregates total cost, tokens, run count, and distinct models used.

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

## How Agents Get Work

Agents receive work through 3 mechanisms. Understanding these is critical for building the right UI and automation patterns.

### 1. Scheduled Routines (automatic, recurring)

A routine fires on a cron schedule and wakes the agent. The agent does its predefined job — no task assignment needed.

```
Routine (*/15 * * * *) → wake email-triage agent → agent checks inbox, classifies, creates tasks
Routine (0 9 * * *)   → wake social-writer     → agent researches and drafts posts
```

**When to use:** Recurring background work that always needs doing (email sync, daily briefings, weekly planning).

### 2. Task Assignment + Wake (user-initiated or agent-initiated)

A user (or another agent) creates a task, assigns it to an agent, and wakes the agent. The agent sees the assigned task in its context and works on it.

```
User creates "Write Q2 proposal for Acme Corp"
  → Assigns to Content & Social Writer
  → Clicks "Assign & Run" (or Wake button)
  → Agent wakes, sees the task, drafts the proposal, saves to Drive
```

**API flow:**
```bash
# Create task (assigned to agent)
POST /api/admin/tasks
{ "title": "Write Q2 proposal", "assigneeAgentId": "content-writer-id" }

# Create task (assigned to user — defaults to current user if omitted with session auth)
POST /api/admin/tasks
{ "title": "Review Q2 proposal", "assigneeUserId": "user-id" }

# Wake the agent (assigns + runs)
POST /api/admin/agents/:id/wake
# OR use the combined assign endpoint:
POST /api/admin/tasks/:id/assign
{ "agentId": "content-writer-id", "wake": true }
```

**UI pattern (Assign & Run):**
```tsx
// On the task detail page — agent picker dropdown + run button
<select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
  <option value="">Unassigned</option>
  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
</select>
<button onClick={async () => {
  await client.assignTask(taskId, assignee, true); // true = also wake
}}>
  Assign & Run
</button>
```

**When to use:** On-demand work — proposals, investigations, document drafting, any task that needs human initiation.

### 3. Delegation (agent-to-agent)

A manager agent creates a task and assigns it to a report. The framework can auto-wake the report.

```
Goal Planner (CEO) creates "Implement auth module"
  → findDelegateForTask() matches → Engineer
  → Task assigned to Engineer, engineer wakes
  → Engineer works, posts progress as comments
  → When done, CEO reviews
```

**When to use:** Hierarchical teams where work flows from managers to ICs.

### Key Principle: Agents only work when woken

Agents are **not running continuously**. They're CLI processes that start, do work, and exit. An agent has no work unless:
- A routine wakes it (scheduled)
- A user wakes it (manual, via Wake button or Assign & Run)
- Another agent delegates to it (programmatic)

Between runs, agents are just rows in the database with `status: "idle"`.

### What the agent sees when it wakes

The context pipeline injects:
1. **System instructions** — persona, guidelines, protocol
2. **Assigned task** — if any task is assigned with status todo/in_progress
3. **Task comments** — conversation history
4. **Memory** — recalled context from prior sessions
5. **Hierarchy** — who they report to, who reports to them

The agent then uses the callback API to read more tasks, create subtasks, post comments, etc.

---

## Agent Templates & Teams (Pre-built Personas)

Instead of writing agent instructions from scratch, use the framework's built-in personas. Each role has a full persona bundle (SOUL.md, AGENTS.md, HEARTBEAT.md) that defines how the agent thinks, communicates, and operates.

### Available Roles (12 built-in)

| Role | Aliases | Character |
|------|---------|-----------|
| `ceo` | — | Strategic, action-biased, owns P&L, direct communication |
| `cto` | — | Technical direction, simplicity-focused, trade-off aware |
| `engineer` | general, frontend, backend, full-stack | Pragmatic, test-driven, collaborative |
| `pm` | product manager, product-manager | User-problem driven, scope ruthless, decisive |
| `qa` | quality assurance | Adversarial thinking, edge-case focused |
| `researcher` | data scientist, analyst | Fact-based, triangulation, flags uncertainties |
| `designer` | ux designer | User-first, accessibility mandatory |
| `devops` | sre, ops | Automation-first, IaC, monitoring before optimization |
| `personal-assistant` | assistant, ea, chief of staff | Organized, proactive, concise, time-explicit |
| `content-creator` | content, social media, marketing | Hook-driven, platform-aware, authentic |
| `finance` | accountant, bookkeeper, finance agent | Precise, methodical, no approximations |
| `default` | (fallback) | Generic worker, keeps work moving |

### Create Agent from Template

```typescript
import { createAgentFromTemplate } from "@boringos/agent";

const agent = await createAgentFromTemplate(db, "engineer", {
  tenantId: "...",
  name: "Backend Engineer",      // optional — auto-generated from role if omitted
  runtimeId: "...",              // optional
  reportsTo: ctoAgentId,        // optional — sets hierarchy
});
// Returns: { id, name, role, tenantId, reportsTo }
```

Or via admin API:
```bash
POST /api/admin/agents/from-template
{ "role": "engineer", "name": "Backend Engineer", "reportsTo": "cto-agent-id" }
```

### Create a Full Team (One Call)

```typescript
import { createTeam } from "@boringos/agent";

const agents = await createTeam(db, "engineering", {
  tenantId: "...",
  runtimeId: "...",
});
// Returns array: CTO, Senior Engineer, Engineer, QA Engineer
// Hierarchy already wired (engineers report to CTO)
```

Or via admin API:
```bash
POST /api/admin/teams/from-template
{ "template": "engineering" }
```

### 5 Built-in Team Templates

| Template | Agents Created | Hierarchy |
|----------|---------------|-----------|
| **engineering** | CTO, Senior Engineer, Engineer, QA Engineer | All report to CTO |
| **executive** | CEO, CTO, Product Manager, Executive Assistant | All report to CEO |
| **content** | Content Lead, Research Analyst | Researcher reports to Lead |
| **sales** | Sales Director, Lead Researcher, Sales Engineer, Sales Coordinator | All report to Director |
| **support** | Support Manager, Tier 1 Support, Tier 2 Support | All report to Manager |

```bash
# List available templates
GET /api/admin/teams/templates
```

### Custom Personas

Register custom persona bundles for roles not covered by built-ins:

```typescript
app.persona("tax-specialist", {
  soul: "You are a tax specialist. You know international tax law...",
  agents: "When working with the finance agent, provide tax-specific guidance...",
  heartbeat: "Review tax deadlines weekly. Flag upcoming filing dates...",
});
```

---

## Agent Hierarchy (Skills, Delegation, Handoff, Escalation)

Agents live in an org: each has a boss (`reportsTo`), a set of `skills`, and a role. The framework provides typed delegation, peer-aware context, a handoff primitive, and cycle-safe reparenting.

### Data model

| Column | Purpose |
|---|---|
| `role` | Short immutable identity (e.g. `vp-sales`, `engineer`). Used as fallback for routing and for agent names in prompts. |
| `skills` | JSONB array of capability tags (e.g. `["deal-coaching", "competitor-analysis"]`). Primary signal for the delegation router. Editable anytime. |
| `reportsTo` | Parent agent. Cycle-checked on every edit. |
| `instructions` | Per-agent prompt/persona. |
| `status` | `idle` / `running` / `paused` / `archived`. Paused and archived agents are skipped by the delegation router. |

### Setting up hierarchy

```typescript
const ceo = await createAgent({ name: "CEO", role: "ceo" });
const vp = await createAgent({
  name: "VP Sales", role: "vp-sales",
  reportsTo: ceo.id,
  skills: ["deal-coaching", "pipeline-review"],
});
```

Team templates create a full hierarchy in one call and are the recommended starting point for new tenants.

### Org tree

```bash
GET /api/admin/agents/org-tree
# Returns:
# { tree: [
#   { id: "ceo-id", name: "CEO", role: "ceo", status: "idle", reports: [
#     { id: "vp-id", name: "VP Sales", role: "vp-sales", status: "idle", reports: [] }
#   ]}
# ]}
```

```typescript
import { buildOrgTree } from "@boringos/agent";
const tree = await buildOrgTree(db, tenantId);
```

### Delegation — three tiers

`findDelegateForTask` accepts either a bare title (legacy) or a structured query, and resolves in order:

1. **Tier A — exact skill match.** If the query carries a `requiredSkill` hint, or a skill name from a candidate agent appears in the task title/description, that agent wins.
2. **Tier B — role keyword heuristic.** The original regex by role (`engineer`, `devops`, `qa`, etc.) is used as a fallback when no skill matches.
3. **Tier C — LLM router (opt-in).** Stub by default; apps opt in via `forceLLM: true`. Apps wiring a real implementation can replace the stub in framework config.

Among tied candidates, the router prefers the agent with the fewest in-flight `todo`/`in_progress` tasks (load-aware tiebreak). Paused and archived agents are skipped.

```typescript
import { findDelegateForTask } from "@boringos/agent";

// Structured query
const id = await findDelegateForTask(db, ceoAgentId, {
  title: "Write up competitor-analysis for Acme",
  requiredSkill: "competitor-analysis",
});

// Legacy string overload still works
const id2 = await findDelegateForTask(db, ceoAgentId, "Fix the login bug");
```

### Handoff — first-class primitive

`createHandoffTask` is the canonical way one agent hands work to another. It writes a subtask assigned to the receiver, posts a comment on the parent explaining the handoff, and enforces a 3-handoff-per-tree depth limit. On overflow, the root task is marked `blocked` rather than spawning another level.

```typescript
import { createHandoffTask } from "@boringos/agent";

const subtaskId = await createHandoffTask(db, {
  fromAgentId: vpSalesId,
  toAgentId: dealAnalystId,
  parentTaskId,
  title: "Assess risk on the Acme deal",
  description: "Needs a quick read on their hesitations around pricing.",
  originKind: "handoff",
  priority: "high",
});
// Returns subtask id, or null if the handoff chain is already too deep.
```

`escalateToManager` is a thin wrapper over `createHandoffTask` with `originKind: "escalation"` and the agent's boss as the target. The two flows share the same machinery; the only difference is which `originKind` label is used and who the recipient is.

### Hierarchy context provider

The framework automatically injects org context into every agent's prompt, bounded to keep the prompt affordable in large tenants:

```
## Your Organization
- You report to: CEO (ceo)
- Your direct reports:
  - Email Triage (email-triage) — idle — skills: classify-email, draft-reply
  - Deal Analyst (deal-analyst) — idle — skills: pipeline-review
- Your colleagues (peers):
  - VP Marketing (vp) — skills: campaign-strategy
  - VP Product (vp) — skills: roadmap [paused]
- Skip-level reports:
  - SDR (sdr)
```

Caps: at most 10 peers and 8 skip-level entries, with `… and N more` truncation beyond that. Paused peers are flagged inline so the agent's reasoning routes around them. The provider injects at `system` phase, priority 15 — no app wiring needed.

### Reparent semantics

- `PATCH /agents/:id` with `reportsTo` runs a cycle check before accepting. Self-reference and any cycle return `409`.
- When an agent is archived (status set to `archived`), the framework reparents its reports to the archived agent's manager. Set-null would orphan a subtree; grandparent preserves structure on departures.
- `agent:reparented` and `agent:updated` events fire on every change — wire them into your realtime UI.

### Dedicated skills endpoint

```
PATCH /api/admin/agents/:id/skills
{ "set": ["deal-coaching", "pipeline-review"] }   # full replacement
{ "add": ["competitor-analysis"] }                # incremental
{ "remove": ["stale-skill"] }                     # incremental
```

Cheaper than round-tripping the whole agent for simple tag edits.

### Admin gating

All agent mutation routes (`POST /agents`, `PATCH /agents/:id`, `PATCH /agents/:id/skills`, `POST /agents/:id/wake`, `POST /agents/from-template`, `POST /teams/from-template`) require `role=admin` when session-authenticated. API-key auth bypasses (treated as superuser for system provisioning). GET routes stay open to all tenant members.

---

## SSE / Realtime Events

BoringOS streams events via Server-Sent Events. Use this to build live-updating UIs.

### Event Types

| Event | When | Data |
|-------|------|------|
| `run:started` | Agent run begins | `{ runId, agentId }` |
| `run:completed` | Agent run finishes | `{ runId, agentId, status }` |
| `run:failed` | Agent run errors | `{ runId, agentId, error }` |
| `task:created` | New task created | `{ taskId, title }` |
| `task:updated` | Task status/field changed | `{ taskId, changes }` |
| `task:comment_added` | Comment posted | `{ taskId, commentId }` |
| `agent:created` | New agent registered | `{ agentId, name }` |
| `approval:decided` | Approval approved/rejected | `{ approvalId, status }` |

### Subscribe from Frontend

```typescript
// Using @boringos/ui client
const unsubscribe = client.subscribe((event) => {
  console.log(event.type, event.data);

  // Invalidate React Query cache for live updates
  switch (event.type) {
    case "run:started":
    case "run:completed":
    case "run:failed":
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      break;
    case "task:created":
    case "task:updated":
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      break;
    case "task:comment_added":
      queryClient.invalidateQueries({ queryKey: ["task", event.data.taskId] });
      break;
  }
});

// Cleanup
unsubscribe();
```

### SSE Endpoint

```
GET /api/events?apiKey=...&tenantId=...
```

30-second heartbeat keeps the connection alive. Reconnect on disconnect with exponential backoff.

### Live Updates Provider Pattern (React)

```tsx
function LiveUpdatesProvider({ children }: { children: React.ReactNode }) {
  const client = useClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsub = client.subscribe((event) => {
      // Invalidate relevant queries based on event type
      handleLiveEvent(event, queryClient);
    });
    return unsub;
  }, [client, queryClient]);

  return <>{children}</>;
}

// Mount once at app root, above all pages
<BoringOSProvider client={client}>
  <LiveUpdatesProvider>
    <App />
  </LiveUpdatesProvider>
</BoringOSProvider>
```

---

## Notifications (Email Alerts)

Send email notifications for important events via Resend.

```typescript
import { createNotificationService } from "@boringos/core";

const notifications = createNotificationService({
  resendApiKey: process.env.RESEND_API_KEY,
  fromEmail: "notifications@myapp.com",
});

// Check if enabled (silently disabled without API key)
notifications.isEnabled(); // true if RESEND_API_KEY is set

// Pre-built templates:
await notifications.taskCompleted(task, recipientEmail);
await notifications.runFailed(run, agent, recipientEmail);
await notifications.approvalNeeded(approval, recipientEmail);
await notifications.budgetWarning(policy, spent, recipientEmail);
```

No configuration needed in BoringOS — just set `RESEND_API_KEY` and the framework sends notifications automatically for run failures and approval requests.

---

## Plugin System

Plugins add cron jobs, webhook handlers, and persistent state to your app.

### Plugin Interface

```typescript
import type { PluginDefinition } from "@boringos/core";

const myPlugin: PluginDefinition = {
  name: "my-plugin",
  version: "1.0.0",

  // Cron jobs — run on schedule with persistent state
  jobs: [
    {
      name: "sync-data",
      cron: "*/15 * * * *",          // Every 15 minutes
      async execute(ctx) {
        const lastSync = ctx.state.get("lastSyncAt");
        // ... do work ...
        ctx.state.set("lastSyncAt", new Date().toISOString());
        return { synced: 42 };
      },
    },
  ],

  // Inbound webhooks — receive HTTP requests from external services
  webhooks: [
    {
      event: "payment-received",
      async handle(req) {
        const body = req.body;
        // ... process webhook ...
        return { ok: true };
      },
    },
  ],
};

// Register
app.plugin(myPlugin);
```

### Webhook URL

```
POST /webhooks/plugins/:pluginName/:event
```

Example: `POST /webhooks/plugins/my-plugin/payment-received`

### Admin API

```bash
GET /api/admin/plugins                              # List plugins
GET /api/admin/plugins/:name/jobs                   # List jobs for plugin
POST /api/admin/plugins/:name/jobs/:job/trigger     # Manual trigger
```

### Built-in GitHub Plugin

The framework includes a GitHub plugin:
- **sync-repos** job — runs every 15 minutes, syncs repository metadata
- **issue-created** webhook — receives GitHub issue events
- **pr-opened** webhook — receives GitHub PR events

---

## Execution Workspaces (Git Worktrees)

Each agent task can run in an isolated git worktree — its own branch and working directory.

```typescript
import { provisionWorkspace, cleanupWorkspace } from "@boringos/agent";

// Create isolated workspace for a task
const workspace = await provisionWorkspace(
  { gitRoot: "/path/to/repo", branchTemplate: "bos/{{identifier}}-{{slug}}", baseRef: "main" },
  task,
);
// workspace.path = "/path/to/repo/.worktrees/bos-BOS-042-fix-login"
// workspace.branch = "bos/BOS-042-fix-login"

// Agent runs in workspace.path with workspace.branch checked out
// ...

// Cleanup when done
await cleanupWorkspace("/path/to/repo", workspace.path);
```

The branch template supports tokens: `{{identifier}}` (task ID like BOS-042), `{{slug}}` (slugified title).

---

## Skill System

Skills are markdown files + assets that teach agents domain-specific knowledge. They're synced into the agent's working directory before execution.

### Skill Sources

| Source | How it works |
|--------|-------------|
| `local_path` | Symlinks from a local directory |
| `github` | Fetches from a GitHub repo via API |
| `url` | Downloads from a URL |

### Trust Levels

| Level | Allowed files |
|-------|--------------|
| `markdown_only` | Only `.md` files |
| `assets` | Markdown + images, data files |
| `scripts_executables` | Everything including scripts (use carefully) |

### Usage

```bash
# Create a skill
POST /api/admin/skills
{ "name": "sales-playbook", "source": "local_path", "path": "/skills/sales", "trustLevel": "markdown_only" }

# Attach to an agent
POST /api/admin/skills/:skillId/attach/:agentId

# Detach
DELETE /api/admin/skills/:skillId/attach/:agentId
```

Skills are injected into the agent's working directory via `injectSkills()` before each run.

---

## How to Sync External Data (Email, Calendar, Slack, etc.)

The framework provides 9 workflow block handlers that compose into any sync pattern. The recommended approach is **Pattern A: Workflow stores data in inbox → Agent processes from inbox.**

### The email sync pattern (Pattern A)

```
Routine (every 15min)
  → Workflow:
    1. connector-action  — fetch emails from Gmail (auto-enriched: subject, from, snippet, date)
    2. for-each          — iterate the results
    3. create-inbox-item — store each email in inbox with full metadata
    4. condition          — any new emails?
    5. wake-agent        — wake the triage agent (only if there's work)
```

### Step-by-step: set up Gmail sync

**1. Create the workflow:**

```typescript
const workflow = await store.create({
  tenantId,
  name: "Gmail sync",
  type: "system",
  blocks: [
    { id: "trigger", name: "trigger", type: "trigger", config: {} },
    { id: "fetch", name: "fetch", type: "connector-action", config: {
      connectorKind: "google",
      action: "list_emails",
      inputs: { query: "is:unread", maxResults: 20 },
    }},
    { id: "loop", name: "loop", type: "for-each", config: {
      items: "{{fetch.messages}}",
    }},
    { id: "store", name: "store", type: "create-inbox-item", config: {
      source: "gmail",
      items: "{{loop.items}}",
    }},
    { id: "check", name: "check", type: "condition", config: {
      field: "{{loop.count}}",
      operator: "not_equals",
      value: "0",
    }},
    { id: "wake", name: "wake", type: "wake-agent", config: {
      agentId: "email-triage-agent-id",
    }},
  ],
  edges: [
    { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
    { id: "e2", sourceBlockId: "fetch", targetBlockId: "loop", sourceHandle: null, sortOrder: 0 },
    { id: "e3", sourceBlockId: "loop", targetBlockId: "store", sourceHandle: null, sortOrder: 0 },
    { id: "e4", sourceBlockId: "store", targetBlockId: "check", sourceHandle: null, sortOrder: 0 },
    { id: "e5", sourceBlockId: "check", targetBlockId: "wake", sourceHandle: "condition-true", sortOrder: 0 },
  ],
});
```

**2. Create the routine:**

```typescript
await db.insert(routines).values({
  tenantId,
  title: "Gmail sync",
  workflowId: workflow.id,   // targets workflow, not agent
  cronExpression: "*/15 * * * *",
  concurrencyPolicy: "skip_if_active",
});
```

**3. What happens:**

Every 15 minutes:
1. Workflow calls Gmail API → gets unread emails
2. `for-each` iterates the list
3. `create-inbox-item` stores each email in the inbox (persisted in DB)
4. `condition` checks if there were any
5. If yes → `wake-agent` wakes the triage agent
6. Agent reads from inbox (not Gmail), classifies, creates tasks

Emails are **stored in inbox before the agent runs**. Users see them in the dashboard immediately. Agent works from the inbox, not from Gmail directly. If the agent fails, emails are still saved.

### The same pattern works for any connector

**Slack sync:**
```
connector-action(list_messages) → for-each → create-inbox-item → wake-agent
```

**Calendar sync:**
```
connector-action(list_events) → for-each → create-inbox-item → condition → wake-agent
```

**GitHub sync:**
```
connector-action(list_issues) → for-each → create-inbox-item → wake-agent
```

### Available block handlers (9 total)

| Handler | What it does | Config |
|---|---|---|
| `trigger` | Entry point | — |
| `condition` | Branch true/false | `{ field, operator, value }` |
| `delay` | Wait N ms | `{ durationMs }` |
| `transform` | Map data | `{ mappings: {...} }` |
| `wake-agent` | Wake an agent | `{ agentId, taskId? }` |
| `connector-action` | Call connector API | `{ connectorKind, action, inputs? }` |
| `for-each` | Iterate array | `{ items }` |
| `create-inbox-item` | Store to inbox (emits `inbox.item_created` event) | `{ source, items, assigneeUserId? }` or `{ source, subject, body, from, assigneeUserId? }` |
| `emit-event` | Emit connector event | `{ connectorKind, eventType, data? }` or `{ items }` |

### Why Pattern A (store first, then agent)?

- **Emails persist** even if agent fails or is slow
- **Users see data immediately** in the inbox dashboard
- **Agent works from inbox**, not from external API — no re-fetching, no rate limits
- **Deduplication** via `sourceId` — same email won't be stored twice
- **Cost savings** — agent only wakes when there's actual work (the `condition` check is free)

### Connector enrichment

The `list_emails` action in `@boringos/connector-google` **automatically enriches** results — it fetches subject, from, snippet, and date for each message via Gmail's metadata API. You don't need a separate `read_email` step for basic sync. The `create-inbox-item` handler maps these fields automatically.

Other connectors should follow the same pattern: list actions return **displayable data**, not just IDs.

---

## Drive — File Storage & Memory Sync

### DriveManager

The DriveManager wraps the storage backend + DB indexing + memory sync:

```typescript
import { createDriveManager } from "@boringos/drive";

const drive = createDriveManager({ storage, db, memory, tenantId });

// Write a file — auto-indexed in DB, text files auto-synced to memory
await drive.write("/reports/monthly.md", "# Monthly Report\n...");

// Read
const content = await drive.read("/reports/monthly.md");

// List
const files = await drive.list("/reports/");

// Delete
await drive.remove("/reports/old.md");
```

### Memory Sync

Text files (`.md`, `.txt`, `.json`, `.yaml`) are automatically synced to the memory provider when written via DriveManager. This means:
- Agent writes a report to Drive → it's searchable in memory
- Next agent run can `recall("monthly report")` and find it
- Knowledge persists across sessions without explicit memory calls

### Skill File Revisions

Drive skills have version history:

```bash
GET /api/admin/drive/skill              # Get current skill file
PATCH /api/admin/drive/skill            # Update (creates revision)
GET /api/admin/drive/skill/revisions    # List all revisions
```

---

## Budget Enforcement

Set spending limits per tenant or per agent. The engine checks before each run.

### Budget Policies

```bash
POST /api/admin/budgets
{
  "scope": "agent",              # "tenant" or "agent"
  "agentId": "...",              # required if scope is "agent"
  "period": "monthly",           # "daily", "weekly", or "monthly"
  "limitCents": 10000,           # $100.00
  "warnThresholdCents": 8000     # Warning at $80.00
}
```

### How It Works

1. Before each agent run, engine sums `costEvents` for the policy period
2. If `spent >= limit` → **hard stop** — run is rejected, incident logged
3. If `spent >= warnThreshold` → **warning** — run proceeds, incident logged, notification sent
4. Agents report costs via `POST /api/agent/runs/:runId/cost` during execution

### Admin API

```bash
GET /api/admin/budgets                  # List policies
POST /api/admin/budgets                 # Create policy
DELETE /api/admin/budgets/:id           # Remove policy
GET /api/admin/budgets/incidents        # List incidents (hard_stop + warning)
```

---

## Evaluations (Agent Quality Testing)

A/B test agent quality with structured test cases.

```bash
# Create an eval
POST /api/admin/evals
{
  "name": "Email classification accuracy",
  "testCases": [
    { "input": { "subject": "URGENT: Server down", "from": "client@co.com" }, "expected": "urgent" },
    { "input": { "subject": "Newsletter #42", "from": "news@blog.com" }, "expected": "spam" }
  ]
}

# Run the eval
POST /api/admin/evals/:id/run

# Check results
GET /api/admin/evals/:id/runs
# Returns: { passCount, failCount, results: [...] }
```

Use `useEvals()` hook in the UI to display eval results.

---

## Onboarding Wizard

5-step guided setup for new tenants:

```bash
# Get current state (auto-creates if first request)
GET /api/admin/onboarding

# Complete a step
POST /api/admin/onboarding/complete-step
{ "step": 1, "metadata": { "runtimeConfigured": true } }
```

Steps are tracked per tenant. `completedAt` is set when all 5 steps are done. Use `useOnboarding()` hook in the UI.

---

## Device Auth (CLI Login)

GitHub-style device login flow for CLI tools:

```
1. CLI calls:    POST /api/auth/device/code
                 → { deviceCode, userCode: "A1B2C3D4", expiresIn: 900 }

2. User opens:   http://your-app/auth/device
                 → enters user code "A1B2C3D4"

3. User approves: POST /api/auth/device/verify { userCode: "A1B2C3D4" }

4. CLI polls:    POST /api/auth/device/poll { deviceCode: "..." }
                 → { sessionToken: "..." } (once approved)
```

15-minute expiry on challenges. CLI polls every 5 seconds.

---

## Connector OAuth Flow

### Setup

1. Register connector: `app.connector(google({ clientId: "...", clientSecret: "..." }))`
2. Add OAuth routes (not yet in core — add to your app):

```typescript
import { createOAuthManager } from "@boringos/connector";

const oauth = createOAuthManager(oauthConfig, clientId, clientSecret);

// GET /authorize — redirect to provider consent screen
app.get("/authorize", (c) => c.redirect(oauth.getAuthorizationUrl(callbackUrl)));

// GET /callback — provider redirects here after consent
app.get("/callback", async (c) => {
  const tokens = await oauth.exchangeCode(c.req.query("code"), callbackUrl);
  // Store tokens in connectors table for the tenant
  await db.insert(connectors).values({
    tenantId, kind: "google", status: "active",
    credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
  });
  return c.redirect("/settings?connected=true");
});
```

3. Configure callback URL in provider console (e.g., Google Cloud Console)

### Checking Connection Status

Query the `connectors` table for stored credentials:

```typescript
// Custom endpoint
app.get("/api/connectors/:kind/status", async (c) => {
  const rows = await db.select().from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, c.req.param("kind"))))
    .limit(1);
  return c.json({ connected: rows.length > 0 && !!rows[0].credentials });
});
```

### Token Refresh

The `OAuthManager` provides `refreshTokens(refreshToken)` for automatic token refresh when access tokens expire.

---

## Agent-to-Agent Communication

Agents communicate through **tasks and comments**, not direct messages. The hierarchy system enables structured communication patterns.

### Delegation Pattern

```
CTO receives "Build feature X" task
  → CTO calls findDelegateForTask() → matches Engineer
  → CTO creates subtask "Implement feature X" assigned to Engineer
  → Engineer works, posts comments with progress
  → CTO reads subtask status to track progress
  → When subtask is done, CTO marks parent task as done
```

### Escalation Pattern

```
Engineer is stuck on "Fix bug Y" task
  → Engineer calls escalateToManager()
  → Framework creates "[Escalation] Engineer blocked on: Fix bug Y" task for CTO
  → CTO wakes, sees escalation task, provides guidance as comment
  → Engineer reads comment, unblocks, continues
```

### Review Pattern

```
Agent completes work → sets task status to "in_review"
  → Manager agent wakes (routine or workflow trigger)
  → Reads tasks in "in_review" status assigned to their reports
  → Reviews work products, posts approval/feedback as comments
  → Sets status to "done" or back to "in_progress" with feedback
```

---

## Error Handling

### Agent Run Failures

When an agent run fails:
1. Run status set to `failed` with error message
2. SSE event `run:failed` emitted
3. If notifications enabled, email sent to configured address
4. Run can be retried via `POST /api/admin/agents/:id/wake`

### Workflow Block Failures

When a workflow block fails:
1. Block status set to `failed` with error
2. Downstream blocks are **skipped** (not executed)
3. Workflow result status is `failed`
4. Other branches (from prior condition blocks) still execute

### Budget Hard Stops

When budget is exceeded:
1. Run is rejected before spawning
2. Incident logged with `type: "hard_stop"`
3. Agent status remains `idle`
4. Notification sent if configured

### Connector Action Failures

The `connector-action` block handler returns `{ success: false, error: "..." }` on failure. Use a condition block after it to branch on success/failure.

---

## Deployment (Production)

### External Postgres

```env
DATABASE_URL=postgres://user:pass@host:5432/boringos
```

Remove `{ embedded: true }` — just provide the URL.

### Redis + BullMQ (Persistent Queue)

```typescript
import { createBullMQQueue } from "@boringos/pipeline";
app.queue(createBullMQQueue({ redis: process.env.REDIS_URL }));
```

Benefits: persistent jobs, automatic retries, configurable concurrency.

### Environment Variables (Production)

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://...           # Required
REDIS_URL=redis://...                 # Recommended
AUTH_SECRET=strong-random-secret      # Required — use a real secret
ADMIN_KEY=strong-random-key           # Required

# Optional
RESEND_API_KEY=...                    # Email notifications
HEBBS_ENDPOINT=...                    # Agent memory
HEBBS_API_KEY=...
```

### Health Check

```
GET /health → { "status": "ok", "timestamp": "..." }
```

Use this for load balancer health probes.

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

Every entity page MUST implement full CRUD unless explicitly marked read-only. This is not optional.

### MANDATORY Checklist — Every Entity Page

Before considering a page done, verify ALL of these are implemented:

- [ ] **List view** with loading state and empty state (icon + message + CTA button)
- [ ] **Create** — [+ Add] button in header that opens a modal with form fields, validation, submit, cancel
- [ ] **Inline edit** — Click any text field (title, name) to edit in place. Status/priority via dropdown. Blur or Enter saves. Escape cancels.
- [ ] **Delete** — Delete/Archive button on each item with inline confirmation ("Are you sure? [Yes] [No]")
- [ ] **Filters** — At least one filter (status, type, label) where applicable
- [ ] **Actions** — Entity-specific actions (Wake agent, Trigger routine, Approve/Reject, etc.)
- [ ] **Error handling** — Show error message on failed operations, don't silently swallow errors
- [ ] **Responsive** — Works on both wide and narrow screens

**Entities that are read-only (no edit/delete needed):**
- Activity Log — audit trail, read-only by design
- Runs — read + cancel only
- Connectors — read + connect/disconnect only

**Everything else MUST have create + edit + delete.**

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
- Filter by: status, label, assignee (agent or user), priority
- [+ New Task] button
- Each row shows: identifier (BOS-001), title, priority badge, status badge, assignee
- Use `?assigneeUserId=me` to show only the current user's tasks

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
- `assigneeUserId` — dropdown of users (defaults to current user)
- `parentId` — optional, for subtasks
- `labels` — multi-select

**Detail** (`/tasks/:id`):
- Editable inline: title, description, status, priority
- Tabs: Comments | Work Products | Subtasks
- Comment thread with add comment form
- **Assign & Run** — agent picker dropdown + "Assign & Run" button (MUST have this)
- [Delete] with confirmation

**Assign & Run pattern** (MUST be on every task detail view):
```tsx
// Agent picker + run button
<div className="flex items-center gap-2">
  <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
    <option value="">Unassigned</option>
    {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
  </select>
  <button onClick={() => client.assignTask(taskId, assignee, true)}>
    Assign & Run
  </button>
</div>
// assignTask(taskId, agentId, wake=true) assigns the task AND wakes the agent
```

**Also on task list view:**
- Each task row shows the assignee name (or "Unassigned")
- Clicking the assignee shows a dropdown to reassign

**API calls:**
```typescript
const tasks = await client.getTasks({ status: "todo" });
const myTasks = await client.getTasks({ assigneeUserId: "me" });
await client.createTask({ title, description, priority, assigneeAgentId, assigneeUserId, parentId });
await client.updateTask(taskId, { status: "done", title: "Updated" });
await client.assignTask(taskId, agentId, true);  // assign + wake in one call
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

**Visual Editor** — use `@xyflow/react` v12+ (React Flow). This is the standard library for workflow editing in BoringOS apps.

```bash
npm install @xyflow/react
```

**Architecture: 3-panel layout**

```
┌──────────┬──────────────────────────────┬──────────────┐
│  Block   │                              │   Config     │
│  Palette │      React Flow Canvas       │   Panel      │
│  (left)  │      (center, drag/drop)     │   (right)    │
│          │                              │              │
│  Drag    │   [Trigger] → [Condition]    │  Block Name  │
│  blocks  │              ↙        ↘      │  Block Type  │
│  here    │   [Agent]        [Done]      │  Config Form │
│          │                              │              │
│          │              [Save]          │              │
└──────────┴──────────────────────────────┴──────────────┘
```

**4 components needed:**

1. **WorkflowCanvas** — wraps ReactFlow with `useNodesState`, `useEdgesState`, `onConnect`, `onDrop`. Converts DB blocks/edges to React Flow nodes/edges. Save button converts back.

2. **BlockPalette** — left sidebar with draggable block types in sections (Triggers, Logic, Agent, Actions). Uses `onDragStart` with `dataTransfer.setData("application/workflow-block", JSON.stringify({type, label}))`.

3. **BlockNode** — custom React Flow node. Different colors/icons per type. Condition nodes have two output handles (green=true, red=false). Shows config preview text.

4. **BlockConfigPanel** — right sidebar for selected node. Form fields change based on block type (connector-action needs kind+action+inputs, condition needs field+operator+value, wake-agent needs agentId).

**React Flow node type registration:**
```tsx
import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodeTypes = { block: BlockNode };

<ReactFlow
  nodes={nodes} edges={edges}
  onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
  onConnect={onConnect} onDrop={onDrop} onDragOver={onDragOver}
  onNodeClick={onNodeClick} onPaneClick={onPaneClick}
  nodeTypes={nodeTypes} fitView
>
  <Background color="#e2e8f0" gap={20} />
  <Controls />
</ReactFlow>
```

**BlockNode handles for branching:**
```tsx
// Condition node: two output handles
{isCondition && (
  <>
    <Handle type="source" position={Position.Bottom} id="condition-true"
      className="!bg-green-500" style={{ left: "30%" }} />
    <Handle type="source" position={Position.Bottom} id="condition-false"
      className="!bg-red-500" style={{ left: "70%" }} />
  </>
)}

// Normal node: single output handle
{!isCondition && (
  <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
)}
```

**Block type colors (consistent across list view and editor):**
```tsx
const TYPE_COLORS = {
  trigger:           { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700" },
  condition:         { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
  "wake-agent":      { bg: "bg-blue-50",   border: "border-blue-200",  text: "text-blue-700" },
  "connector-action":{ bg: "bg-green-50",  border: "border-green-200", text: "text-green-700" },
  transform:         { bg: "bg-gray-50",   border: "border-gray-200",  text: "text-gray-700" },
  delay:             { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
};
```

**Reference implementation:** See `boringos/apps/web/src/components/workflows/` for the full working editor (WorkflowCanvas, BlockPalette, BlockNode, BlockConfigPanel).

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
- Filter tabs: All | Unread | Archived | Mine (uses `?assigneeUserId=me`)
- Each item shows: source badge (gmail, slack), subject, body preview, timestamp, assignee
- Unread items have a left border accent
- Actions per item: [Create Task] [Archive] [Mark Read]
- [Create Task] converts inbox item to a task with pre-filled fields (assigneeUserId defaults to current user)

**API calls:**
```bash
GET /api/admin/inbox                          # all items for tenant
GET /api/admin/inbox?assigneeUserId=me        # my items only
GET /api/admin/inbox/:id                      # marks as read
POST /api/admin/inbox/:id/archive
POST /api/admin/inbox/:id/create-task         # assigneeUserId defaults to current user
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
| `.onEvent(type, handler)` | Subscribe to EventBus events (e.g., `"inbox.item_created"`) |
| `.routeToInbox(config)` | Route connector events to inbox (transform can return `assigneeUserId`) |
| `.route(path, app)` | Mount custom Hono routes |
| `.beforeStart(fn)` / `.afterStart(fn)` / `.beforeShutdown(fn)` | Lifecycle hooks |
| `.listen(port?)` | Boot and start HTTP server |

---

## Copilot (Built-in AI Assistant)

Every BoringOS app ships with a built-in copilot — a conversational AI agent that can both **operate** your system and **build** new features. Zero configuration needed.

**Multi-tenant:** The copilot is now fully multi-tenant. `/api/copilot/*` routes resolve the tenant from the session token — no longer hardcoded to the first tenant. A copilot agent is auto-created for each new tenant on signup.

### How it works

```
User types "Show me all blocked tasks" in the copilot chat
  → Message saved as comment on a copilot session (task with originKind="copilot")
  → Copilot agent auto-wakes (same pattern as comment → wake on any task)
  → Agent reads the conversation, calls GET /api/admin/tasks, filters blocked
  → Agent posts reply as comment: "Found 1 blocked task: BOS-005..."
  → UI polls for new comments, renders the reply
```

### What the copilot can do

| Ask | What it does |
|-----|-------------|
| "Show me all tasks" | Calls admin API, formats results |
| "Create a task to review Q2 goals" | Calls POST /api/admin/tasks |
| "Pause the finance agent" | Calls PATCH /api/admin/agents/:id |
| "Why did the last run fail?" | Reads run logs via API |
| "Add a chart to the dashboard" | Reads code, edits page.tsx |
| "Change email sync to every 5 min" | Edits workflow or routine config |
| "What does the email triage agent do?" | Reads agent instructions from code |

### Architecture

```
Copilot session = Task (originKind: "copilot")
User message    = Comment (authorUserId)
Agent reply     = Comment (authorAgentId)
Chat UI         = renders comments as conversation bubbles
```

No new primitives. Reuses: tasks, comments, auto-wake on comment, agent execution pipeline.

### API

```bash
# Create a session
POST /api/copilot/sessions
→ { id: "session-uuid", title: "Copilot — Apr 11" }

# List sessions
GET /api/copilot/sessions
→ { sessions: [...] }

# Get session with messages
GET /api/copilot/sessions/:id
→ { session: {...}, messages: [{ id, body, role: "user"|"assistant", createdAt }] }

# Send a message (auto-wakes the copilot agent)
POST /api/copilot/sessions/:id/message
{ "message": "Show me all blocked tasks" }
→ { id: "comment-id", agentWoken: true }

# Archive session
DELETE /api/copilot/sessions/:id
```

### For app developers

**Zero config — it just works:**
```typescript
const app = new BoringOS({ auth: { adminKey: "..." } });
app.listen(3000);
// /api/copilot/* routes are available
// Copilot agent is auto-created on boot
```

**Optional customization:**
```typescript
// Add app-specific knowledge to the copilot's context
app.copilotContext("Our app uses Stripe for billing. The billing table is...");
```

**UI — use the built-in chat component or build your own:**
```tsx
// Drop-in chat panel
import { CopilotPanel } from "@boringos/ui";
<CopilotPanel />

// Or build your own using the API
const res = await fetch("/api/copilot/sessions/:id/message", {
  method: "POST",
  body: JSON.stringify({ message: "Show me all tasks" }),
});
```

### The copilot agent

- **Role:** `copilot` (new built-in persona alongside ceo, engineer, etc.)
- **Auto-created:** On first boot, for the first tenant
- **Not in org tree:** System agent, doesn't report to anyone
- **Instructions:** Knows BUILD_GUIDELINE.md, CLAUDE.md, admin API, how to read/edit code
- **Runtime:** Uses the default runtime (Claude CLI, Codex, etc.)

### Agent Permissions

All agents (including copilot) run with `--dangerously-skip-permissions`:
- Full file read/write access — agents can edit source code, create files, run commands
- Required for autonomous operation — no human available to approve interactively in background runs
- This flag is set in the Claude runtime (`packages/@boringos/runtime/src/runtimes/claude.ts`)

### Auto-Post Agent Results

After every agent run on a task, the framework automatically:
1. Reads the run's `stdoutExcerpt` from the DB
2. Parses the stream-json output to extract the `result` text
3. Posts it as a comment on the task with `authorAgentId` set

This enables conversational workflows without agents explicitly calling the comment API:
```
User posts comment → agent wakes → agent works → agent output saved to run
→ framework extracts result → posts as comment → user sees reply
```

This is what powers the copilot chat — but it works for ALL task-based agent runs. Any agent that runs on a task will have its result posted as a comment automatically.

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

### Pattern: Event-Driven Agent Wake (Reactive, Not Routine)

BoringOS is event-driven, not just routine-driven. Instead of polling on a cron schedule, agents can wake reactively when something happens.

**How it works:**

```
Ingest workflow → create-inbox-item → emits inbox.item_created event
                                              ↓
                               app.onEvent("inbox.item_created", handler)
                                              ↓
                                    Wake triage agent / enrichment agent / etc.
```

**Subscribe to events** with `app.onEvent(type, handler)`:

```typescript
app.onEvent("inbox.item_created", async (event) => {
  // event is ConnectorEvent: { connectorKind, type, tenantId, data, timestamp }
  // event.data contains { itemId, source }
  const agentEngine = context.agentEngine;
  await agentEngine.wake({ agentId: triageAgentId, tenantId: event.tenantId,
    reason: "connector_event", payload: event.data });
});
```

**Emit events** from your own routes via `AppContext.eventBus`:

```typescript
app.beforeStart(async (ctx) => {
  // In a route handler:
  ctx.eventBus.emit({
    connectorKind: "app", type: "entity.created",
    tenantId, data: { entityType: "crm_contact", entityId: id },
    timestamp: new Date(),
  });
});
```

**Built-in events:**
- `inbox.item_created` — emitted by the `create-inbox-item` workflow handler with `{ itemId, source }` in data

**Update inbox items** with `PATCH /api/admin/inbox/:id` — agents write analysis results (metadata, status, assigneeUserId) back to inbox items after processing.

**Why events > routines for reactive features:**
- Routines poll on a schedule — waste cost when nothing happened, add latency when something did
- Events fire immediately when data arrives — zero latency, zero wasted agent runs
- Composable: multiple subscribers can react to the same event (triage agent + enrichment agent + notification)
- The `create-inbox-item` handler emits events automatically — no extra workflow blocks needed

### Pattern: Agent Pause/Resume

BoringOS supports pausing agents at two levels — useful for maintenance, cost control, or incident response.

**Global pause** — pause ALL agents for the entire tenant:

```bash
curl -X PATCH /api/admin/settings \
  -H "X-API-Key: ..." -H "X-Tenant-Id: ..." \
  -d '{"agents_paused": "true"}'
```

**Per-agent pause** — pause a single agent:

```bash
curl -X PATCH /api/admin/agents/:id \
  -H "X-API-Key: ..." -H "X-Tenant-Id: ..." \
  -d '{"status": "paused"}'
```

**Pause behavior:**
- Already-running agents are NOT killed — they finish their current run
- New runs are skipped with `status: "skipped"` and error code `agents_paused` (global) or `agent_paused` (per-agent)
- Events still fire, tasks still get created — only CLI spawning is blocked
- Budget is not consumed during pause

**Resume** — set `agents_paused` to `"false"` (global) or `status` to `"idle"` (per-agent). On global resume, the framework auto-re-wakes all agents that have pending `todo` tasks. No work is lost during pause.

**Auto-re-wake after run** — after any agent run completes, the engine checks if that agent has remaining `todo` tasks. If yes, it auto-re-wakes the agent. This prevents tasks from getting stuck when multiple events coalesce into a single run.

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
| Add a new agent | `src/agents/my-agent.ts` + register in seed, OR use `createAgentFromTemplate(db, "role", config)` |
| Use a pre-built persona | Just set `role: "engineer"` (or any of the 12 built-in roles + aliases) |
| Create a full team | `createTeam(db, "engineering", config)` or `POST /api/admin/teams/from-template` |
| Set up agent hierarchy | Set `reportsTo` on agent creation, or use team templates (auto-wired) |
| Delegate tasks between agents | Use `findDelegateForTask(db, agentId, taskTitle)` — role-based matching |
| Escalate blocked tasks | Use `escalateToManager(db, agentId, taskId, reason)` — auto-creates task for boss |
| Add agent instructions | `instructions` field in agent definition |
| Schedule an agent | Create a routine in seed (agent or workflow target) |
| Add a workflow | `src/workflows/my-workflow.ts` + create via store in seed |
| Add a workflow block type | `src/block-handlers/my-handler.ts` + `app.blockHandler()` |
| Inject context into agents | `src/context-providers/my-provider.ts` + `app.contextProvider()` |
| Connect an external service | `app.connector(...)` + add OAuth routes for auth flow |
| Check connector status | Query `connectors` table for stored credentials |
| Route events to inbox | `app.routeToInbox(...)` in index.ts |
| Add a custom API endpoint | `app.route("/path", honoApp)` in index.ts |
| Add a UI page | `ui/src/app/my-page/page.tsx` + add to sidebar |
| Add live updates to UI | `client.subscribe()` + invalidate React Query cache on events |
| Send email notifications | Set `RESEND_API_KEY` — framework sends automatically for failures/approvals |
| Add a plugin | Implement `PluginDefinition` + `app.plugin(myPlugin)` |
| Set spending limits | `POST /api/admin/budgets` — engine enforces before each run |
| Test agent quality | `POST /api/admin/evals` with test cases, then `/run` |
| Add agent skills | `POST /api/admin/skills` + attach to agents |
| Isolate agent work | `provisionWorkspace()` — creates git worktree per task |
| Store files with memory sync | `DriveManager.write()` — auto-indexes + syncs text to memory |
| Create seed data | `src/seed.ts` — call admin API |
| Add custom DB tables | `app.schema("CREATE TABLE ...")` in index.ts |
| Deploy to production | Set `DATABASE_URL` + `REDIS_URL` + `AUTH_SECRET`, use BullMQ queue |
| Use the copilot | It's automatic — `/api/copilot/*` routes available on boot, agent auto-created |
| Add copilot chat to UI | Use `<CopilotPanel />` from `@boringos/ui`, or build custom UI with the copilot API |
| Teach copilot app-specific knowledge | `app.copilotContext("Our app uses Stripe...")` |

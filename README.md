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
- **Admin REST API** — manage agents, tasks, runs, runtimes, approvals, tenant settings via API key auth
- **Agent pause / kill switch** — global tenant-level and per-agent pause with `skipped` run status, auto-re-wake on resume for pending tasks
- **Runtime model management** — model catalog per runtime, admin model selection, automatic config sync
- **SSE realtime events** — live streaming of run status, task updates, approvals
- **User auth (multi-tenant SaaS)** — signup with `tenantName` (creates new tenant) or `inviteCode` (joins existing), login returns all tenants, `/me` with `X-Tenant-Id` for switching, invitation system (create/list/revoke), team management (list users, change roles, remove members), exportable `createAuthMiddleware(db)` for custom routes
- **Activity logging** — audit trail for all admin mutations
- **Budget enforcement** — cost limits per agent/tenant with hard-stop + warnings
- **Routine scheduler** — cron-based recurring agent tasks
- **Notifications** — email via Resend (task completion, failures, approvals)
- **Execution workspaces** — git worktree provisioning for code tasks
- **Skill system** — sync from GitHub/URL, per-agent attachment, trust levels
- **Plugin system** — extensible jobs + webhooks, built-in GitHub plugin ([guide](PLUGINS.md))
- **Projects & Goals** — organize tasks into projects with repo config, auto-identifiers (ALPHA-001)
- **Task features** — labels, read states, attachments, checkout locks
- **Drive features** — file indexing, memory sync, drive skill revisions
- **Onboarding** — 5-step setup wizard per tenant
- **Device auth** — CLI login flow (generate code → browser approve → poll for token)
- **Evaluations** — A/B test agent quality with structured test cases
- **Inbox** — receive and triage external messages, convert to tasks, assign to users via `assigneeUserId`
- **Custom schema** — `.schema(ddl)` to add your own tables that reference framework tables
- **Entity linking** — link domain entities (contacts, deals) to tasks, runs, inbox items
- **Event-driven architecture** — apps emit and subscribe to events via `EventBus`, agents wake reactively on `inbox.item_created` and custom events
- **Event-to-inbox routing** — declaratively route connector events to inbox
- **Cross-entity search** — `GET /api/admin/search?q=` across tasks, agents, inbox
- **Agent templates** — `createAgentFromTemplate(role)` with built-in personas
- **Team templates** — `createTeam("engineering")` wires up CTO + engineers + QA with hierarchy
- **Agent hierarchy** — org tree, delegation to reports, escalation to manager
- **Data sync** — workflow-triggered sync for email, calendar, Slack (connector-action → for-each → create-inbox-item → wake-agent)
- **Auto-wake on comment** — posting a comment on an assigned task auto-wakes the agent
- **Auto-post results** — agent run output auto-posted as comment on the task
- **Built-in copilot (multi-tenant)** — conversational AI assistant that can operate the system AND build features, resolves tenant from session token, auto-created per tenant on signup
- **Convention over configuration** — everything works with zero config

## Agent Hierarchy

Create an entire AI org in one API call. Agents delegate down, escalate up, and share memory across the tree.

```
                                 ┌─────────┐
                                 │   CEO   │
                                 │Strategy │
                                 └────┬────┘
                    ┌─────────────┬───┴────┬──────────────┐
                    │             │        │              │
              ┌─────┴─────┐ ┌────┴────┐ ┌─┴───────┐ ┌────┴─────┐
              │    CTO    │ │   CMO   │ │VP Sales │ │ Copilot  │
              │  Tech Lead│ │Marketing│ │ Revenue │ │AI Assist │
              └─────┬─────┘ └────┬────┘ └────┬────┘ └──────────┘
           ┌────────┼────────┐   │  ┌────┐   │  ┌─────┐
           │        │        │   │  │    │   │  │     │
       ┌───┴───┐┌───┴───┐┌──┴──┐│  │    │   │  │     │
       │Frontend││Backend││ QA  ││  │    │   │  │     │
       │  Eng   ││  Eng  ││     ││  │    │   │  │     │
       └───────┘└───────┘└─────┘│  │    │   │  │     │
                          ┌─────┴──┴┐┌──┴───┴┐┌┴─────┴┐
                          │Researcher││ SDR   ││  AE   │
                          │& Writer  ││Outbnd ││Closer │
                          └─────────┘└───────┘└───────┘
```

```typescript
// One call creates the full engineering team
await createTeam(db, "engineering", { tenantId });
// → CTO (reports to: none)
// → Senior Engineer (reports to: CTO)
// → Engineer (reports to: CTO)
// → QA Engineer (reports to: CTO)

// CEO delegates "Build the MVP" → CTO breaks it down →
// Engineers execute → QA validates → tasks complete.
```

**Delegation flows down.** CEO assigns a goal to CTO. CTO creates subtasks, assigns to engineers. Engineers spawn CLI runtimes (Claude, Codex, Gemini), write code, run tests, post updates.

**Escalation flows up.** Stuck? Agent escalates to its manager. Need approval? Humans approve via dashboard. Done? Tasks close, memory persists, next goal begins.

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
app.onTenantCreated(async (db, tenantId) => { ... }); // app-specific tenant setup
app.beforeStart(async (ctx) => { ... });       // lifecycle hooks
app.route("/custom", honoApp);                 // mount custom routes

const server = await app.listen(3000);
```

## Commands

```bash
pnpm install           # Install dependencies
pnpm -r build          # Build all packages
pnpm -r typecheck      # Typecheck all packages
pnpm test:run          # Run all tests (126 tests)
```

## Examples

- [`examples/quickstart/`](examples/quickstart/) — Boot, create an agent, assign a task, watch it execute
- [Personal OS demo](https://github.com/BoringOS-dev/boringos-demos) — Full personal automation system (email triage, calendar, social media, finance, copilot)

## Detailed Docs

- [CLAUDE.md](CLAUDE.md) — Full framework reference (package details, execution pipeline, all interfaces)
- [BUILD_GUIDELINE.md](BUILD_GUIDELINE.md) — How to build on BoringOS (agents, workflows, UI, copilot, patterns)
- [boringos.dev](https://boringos.dev) — Website + docs

## License

MIT

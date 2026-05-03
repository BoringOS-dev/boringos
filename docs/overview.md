# BusinessOS — Overview & Approach

> The harness is the brain. Everything else is a plugin.

This document orients you on what BusinessOS is, how it is structured, and the reasoning behind the build sequence. Read this before reading any other doc in this repo.

---

## 1. What Is BusinessOS

BusinessOS is the operating layer that connects AI harnesses (Claude CLI, Codex, Gemini, Ollama, custom) to the operations of a business.

It is not a CRM. It is not a workflow tool. It is not a chatbot. It is the OS that makes harnesses safe, persistent, auditable, and useful for real business work — so that every task in the business runs as a harness session, with full memory, full context, and full control.

Apps — CRM, Accounts, Sales, Finance, HR — are plugins that provide context to the harness and receive actions back. The harness is the system. The apps install into it.

---

## 2. The Architecture

BusinessOS has four layers. Each layer is independent, swappable, and built to a stable contract.

```
┌─────────────────────────────────────────────────────────────┐
│                         APPS                                │
│   CRM · Accounts · Sales · Finance · HR · Third-party       │
│   (Each app: schema, agents, workflows, UI slots)            │
├─────────────────────────────────────────────────────────────┤
│                         SHELL                               │
│   Inbox · Copilot · Tasks · Workflows · Agents · Drive      │
│   Apps screen · Connectors · Settings · Team                │
│   (The user-facing OS; the wp-admin equivalent)             │
├─────────────────────────────────────────────────────────────┤
│                       RUNTIME                               │
│   Agent engine · DAG workflow engine · Event bus            │
│   Session memory · Connector framework · Multi-tenancy      │
│   Task model · Approvals · Routines · Activity log          │
│   (boringos-framework — the kernel)                         │
├─────────────────────────────────────────────────────────────┤
│                       HARNESS                               │
│   Claude CLI · Codex · Gemini · Ollama · Command · Webhook  │
│   (Pluggable. The actual reasoning engine.)                 │
└─────────────────────────────────────────────────────────────┘
```

| Layer    | Owns                                                                         | Swappable? |
| -------- | ---------------------------------------------------------------------------- | ---------- |
| Harness  | Reasoning, tool use, multi-step planning                                     | Yes — per tenant, per agent |
| Runtime  | Agent execution, sessions, DAG, events, memory, connectors, tenancy          | No — this is the platform   |
| Shell    | User-facing OS surface, app management, copilot, inbox                       | No — but skinnable          |
| Apps     | Domain-specific schema, agents, workflows, UI                                | Yes — install / uninstall   |

---

## 3. Core Concepts

These terms appear everywhere. Use them precisely.

| Term         | Definition |
|--------------|------------|
| **Harness**  | The AI reasoning engine that executes work. Claude CLI, Codex, Gemini, etc. Spawned as a subprocess by the runtime. Never called as a raw API. |
| **Session**  | A persistent context for a unit of work. Survives across multiple agent runs. Holds task history, comments, work products, memory references. |
| **Task**     | A discrete unit of work with status, priority, assignee, comments, work products. Creating a task opens a session. |
| **Agent**    | A named entity with a persona, instructions, and a runtime binding. Wakes on events, schedules, or manual triggers. Executes inside a session. |
| **DAG / Workflow** | A directed graph of blocks (trigger, condition, wake-agent, connector-action, transform, for-each, etc.) that orchestrates multi-step, multi-agent work. |
| **Event**    | A typed signal on the shared event bus. Apps emit, workflows and other apps subscribe. The async glue between everything. |
| **App**      | A plugin installed into the shell. Declares schema, agents, workflows, UI slots, capability scopes via a manifest. |
| **Manifest** | The contract an app declares: id, version, schema, routes, agents, UI slots, required capabilities, dependencies. The OAuth-consent equivalent. |
| **Capability** | A scoped permission an app requests at install (`tasks:write`, `inbox:read`, `entities.crm:read`, `slots:nav`, etc.). Granted by the tenant. |
| **Slot**     | A named extension point in the shell UI where apps contribute components: `nav`, `dashboard.widget`, `entity.action`, `command.action`, `copilot.tool`. |
| **Tenant**   | A business. The unit of isolation. Every entity in the system has a `tenantId`. |

---

## 4. The Shell

The shell is what a user sees on day one, before any app is installed. It is fully usable on its own — like a vanilla WordPress install.

**Ships with the shell:**

- **Home** — daily brief, agent activity, today's tasks, recent threads
- **Copilot** — always-on thread; reasons across all installed apps
- **Inbox** — unified stream of emails, Slack messages, app-submitted items
- **Tasks** — full task model (status, priority, parent, comments, work products)
- **Agents** — list / create / edit; 12 built-in personas; 6 runtime adapters
- **Workflows** — DAG editor with 9 native block types; cron / event / webhook triggers
- **Drive** — file storage with memory sync
- **Connectors** — Google (Gmail, Calendar), Slack, GitHub out of the box
- **Apps** — browse, install, configure, uninstall (the marketplace UI)
- **Team** — users, roles, invites
- **Settings** — tenant configuration, branding, billing

The shell is agentic without any app. A user can connect Gmail, build a workflow that wakes an agent on incoming email, and ship work — with zero apps installed. Apps make the shell domain-specific; they do not make it useful.

**Default behaviors ship as first-party default apps, not as shell logic.** What look like shell features (email triage, generic reply drafting, default inbox routing) are pre-installed first-party apps following the regular install / disable / uninstall lifecycle. The shell core itself owns only structural surfaces — auth, tenancy, the inbox table, the event bus, the workflow runtime, the agent runtime. This is how the shell stays agnostic to which apps a tenant has installed. See [coordination.md](./coordination.md) for the full pattern.

---

## 5. The App Model

Apps are independent products that install into the shell. They follow the WordPress / Shopify / Stripe Apps pattern.

### The Manifest

Every app declares a manifest:

```ts
{
  id: "crm",
  version: "1.0.0",
  name: "CRM",
  description: "Contacts, companies, deals, pipeline.",
  schema: [...],                  // DDL for namespaced tables
  agents: [...],                  // Agents to register at install
  workflows: [...],               // Workflow templates to install
  contextProviders: [...],        // Inject context into agent prompts
  routes: { ... },                // /api/crm/* routes + agentDocs
  ui: {
    nav: [...],
    dashboardWidgets: [...],
    entityActions: [...],
    settingsPanels: [...],
    copilotTools: [...]
  },
  capabilities: [                 // What it requests; tenant grants on install
    "entities.own:write",
    "entities.core:write",
    "agents:register",
    "events:emit:crm.*",
    "events:subscribe:inbox.item_created",
    "slots:nav",
    "connectors:use:google"
  ],
  dependencies: []                // Other apps it depends on (rare)
}
```

### Capability Scopes

Capabilities are the OAuth-style permission model. Apps declare what they need; the tenant approves at install. No app can do anything it didn't declare.

Categories: `entities.*`, `agents.*`, `workflows.*`, `events.*`, `slots.*`, `connectors.*`, `inbox.*`, `memory.*`.

### Lifecycle

- **Install** → run schema migrations, execute `onTenantCreated`, register agents, mount routes, add UI slots
- **Activate / Deactivate** → toggle without uninstalling (preserve data)
- **Upgrade** → run version migrations
- **Uninstall** → pause agents, hide UI, retain data N days, then drop namespaced tables

### Hybrid Hosting Model

| App type      | Hosting                | When                                        |
| ------------- | ---------------------- | ------------------------------------------- |
| First-party   | In-process (WP-style)  | Trusted, needs DB + schema access           |
| Third-party   | Remote (Shopify-style) | Untrusted; runs on developer infra; UI via remote modules |

Both use the same SDK; only the runtime differs.

---

## 6. Build Approach

The sequencing matters. These decisions are not negotiable per-PR.

### Principle 1 — Ship the shell before any app is rebuilt

The shell is the contract. Until it is stable, every app built against it will be wrong. We ship the shell as a usable product on its own — a fresh tenant gets inbox, copilot, agents, workflows, connectors out of the box, with zero apps installed.

### Principle 2 — Port CRM as the proof, not as a co-build

CRM is the first app. It is rebuilt against the public App SDK *as a third party would build it.* If anything CRM needs cannot be done through the public SDK, that is a gap in the SDK, not a reason to backdoor.

### Principle 3 — Second app proves the contract

Once CRM is ported, the second app (Accounts is the strongest candidate — invoices link to deals, forces canonical entities) tests whether the manifest is right. If we have to bend the contract for app #2, the contract is wrong.

### Principle 4 — Broad beats niche

Every other AI startup is picking a vertical: AI for CRM, AI for finance, AI for HR. The harness reasons across all of them simultaneously. Owning the orchestration layer wins all the niches at once. Resist any pull to ship a vertical product before the platform is stable.

### Principle 5 — The marketplace comes after two apps coexist

Open the SDK to third-party developers only after CRM and Accounts run side-by-side cleanly. Two apps prove the contract; one app does not.

### Sequence

1. **Shell extraction.** Move the shared chrome out of `boringos-crm/packages/web` into `@boringos/shell`. Define slot APIs.
2. **App SDK v1.** Manifest type, capability scopes, lifecycle hooks, slot contributions. Publish to npm.
3. **Apps screen + registry.** `tenant_apps` table; install / activate / upgrade / uninstall lifecycle.
4. **Port CRM.** Rebuild as a manifest-driven app consuming `@boringos/shell` + `@boringos/app-sdk`.
5. **Second app (Accounts).** Built from scratch against the SDK. Promotes `entity_refs` to first-class.
6. **Public marketplace.** SDK + dev portal + signed bundles + billing rails.

---

## 7. What Goes Where

**Two repos. That's it.**

```
boringos-framework/                ← THIS REPO. The whole platform.
  packages/
    @boringos/                       Existing kernel packages (MIT)
      agent/ db/ connector/ connector-slack/ connector-google/
      core/ drive/ memory/ runtime/ shared/ ui/ workflow/ workflow-ui/
    @boringos/                     New platform packages (mixed licenses)
      app-sdk/                       MIT — the public SDK contract
      connector-sdk/                 MIT — connector authoring contract
      shell/                         BSL — the user-facing UI (wp-admin)
      control-plane/                 BSL — install lifecycle, manifest validator
  apps/                              First-party default apps (BSL)
    generic-triage/                  Pre-installed inbox triage
    generic-replier/                 Pre-installed reply drafter
  docs/                              Platform docs (this folder)
  examples/                          Existing examples
  plans/                             Existing plans (kept as-is)
  tests/                             Existing tests

boringos-crm/                      ← Phase 2 target.
                                     Consumer of the platform. Will be ported
                                     to the manifest-driven app model in Phase 2.
                                     Consumes @boringos/app-sdk from registry.
```

Future first-party apps (Sales, Accounts, Finance) get their own repos *when they're built*, not preemptively. Third-party developers build their own repos.

Each package has its own license:

| Layer                 | License              | Reason |
| --------------------- | -------------------- | ------ |
| `@boringos/*` (kernel) | MIT (Apache 2.0 OK) | Maximize adoption; SDKs win by being everywhere |
| `@boringos/shell` | BSL 1.1 (auto-converts to Apache 2.0 in 4 yr) | Commercial moat; competitors blocked from hosting it |
| `@boringos/control-plane` | BSL 1.1 (auto-converts to Apache 2.0 in 4 yr) | Same reasoning as the shell |
| `@boringos/app-sdk`, `@boringos/connector-sdk` | MIT / Apache 2.0 | The contract third-party devs build against |
| First-party apps (`apps/*`) | BSL or proprietary | Sold products |
| Third-party apps & connectors | Author's choice | Each external repo decides |

---

## 8. Reading Order From Here

Once this doc clicks, read in this order:

1. `app-sdk.md` — the manifest contract and capability scopes in detail
2. `shell-screens.md` — what ships with the shell, screen by screen
3. `capabilities.md` — full capability scope catalog
4. `licensing.md` — the license matrix and contributor rules
5. `roadmap.md` — what we are building this quarter, next quarter

---

*Last updated: 2026-04-30*

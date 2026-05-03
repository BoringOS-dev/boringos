# Building Apps

> An app is a domain-specific plugin that turns BoringOS into a vertical-aware operating system — a CRM, an Accounts package, a HR system, anything.

This guide walks through what an app is, what it can do, how to build one, and how to publish it for one-click install.

**Audience:** Developers building full domain plugins.
**Read first:** [Overview](../overview.md), [Building Connectors](./building-connectors.md).

---

## 1. What an App Is

An app is the highest-level extension in BoringOS. It does what a connector does — and far more:

- Defines its own data (schema, entities)
- Registers its own agents and workflow templates
- Contributes UI to the shell (nav, dashboards, entity actions, copilot tools)
- Subscribes to and emits events
- Optionally consumes connectors as plumbing

CRM, Accounts, Sales, Finance, HR — every vertical product runs as an app. First-party and third-party apps use the same SDK and the same hosting model — in v1, all apps run in-process. See [Section 5](#5-hosting).

What an app is **not**:

- Not a website. Apps render *inside* the shell, not as a separate frontend.
- Not a connector. If you only need to integrate an external service, build a connector.
- Not a custom workflow. If you only need automation, use the workflow editor.

Reference implementation: [`@boringos-crm`](../../../hebbs-clients/boringos-crm).

---

## 2. What an App Can Do

| Surface              | What it does                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Schema**           | Register namespaced tables (`crm_*`, `fin_*`); migrations versioned with the app   |
| **Entity types**     | Declare entity types that can be referenced cross-app (e.g. `crm_contact`)         |
| **Agents**           | Seed named agents at install with persona + instructions + runtime binding         |
| **Context providers** | Inject app-specific context into every agent prompt                               |
| **Workflows**        | Ship pre-built DAG templates installed at tenant provision                         |
| **Block types**      | Register custom DAG blocks (e.g. "Update deal stage", "Draft invoice")             |
| **Routes**           | Mount HTTP routes under `/api/{app_id}/*` with `agentDocs` for copilot discovery   |
| **Events**           | Emit events under `{app_id}.*`; subscribe to shell events or other apps' events   |
| **UI slots**         | Contribute components to nav, dashboard, entity views, settings, command bar, copilot |
| **Connector usage**  | Read/write through installed connectors (Gmail, Slack, Stripe, etc.)               |
| **Cross-app reads**  | Read another app's entities (with declared dependency + tenant approval)           |

---

## 3. The Manifest

`boringos.json` at the app's repo root:

```json
{
  "kind": "app",
  "id": "crm",
  "version": "1.0.0",
  "name": "CRM",
  "description": "Contacts, companies, deals, pipeline.",
  "publisher": {
    "name": "BoringOS",
    "homepage": "https://boringos.dev",
    "verified": true
  },
  "hosting": "in-process",

  "schema": "./schema/migrations/",
  "entityTypes": [
    { "id": "crm_contact", "label": "Contact", "icon": "user" },
    { "id": "crm_company", "label": "Company", "icon": "building" },
    { "id": "crm_deal", "label": "Deal", "icon": "trending-up" }
  ],

  "agents": "./src/agents/index.ts",
  "workflows": "./src/workflows/index.ts",
  "contextProviders": "./src/context/index.ts",
  "routes": "./src/routes/index.ts",

  "ui": {
    "entry": "./dist/ui.js",
    "nav": [
      { "id": "pipeline", "label": "Pipeline", "icon": "kanban", "order": 10 },
      { "id": "contacts", "label": "Contacts", "icon": "users", "order": 20 }
    ],
    "dashboardWidgets": ["open-deals", "stalled-deals"],
    "entityActions": [
      { "entity": "crm_deal", "id": "send-followup", "label": "Send follow-up" }
    ],
    "settingsPanels": ["pipeline-config"],
    "copilotTools": ["create_deal", "lookup_contact"]
  },

  "capabilities": [
    "entities.own:write",
    "entities.core:write",
    "agents:register",
    "workflows:register",
    "events:emit:crm.*",
    "events:subscribe:inbox.item_created",
    "events:subscribe:connector.email_received",
    "slots:nav",
    "slots:dashboard.widget",
    "slots:entity.detail",
    "slots:copilot.tool",
    "connectors:use:google",
    "memory:write"
  ],

  "dependencies": [],
  "minRuntime": "1.0.0",
  "license": "BUSL-1.1"
}
```

Compared to a connector manifest, an app declares: `schema`, `entityTypes`, `agents`, `workflows`, `contextProviders`, `routes`, `ui`, and a much broader `capabilities` set.

---

## 4. Anatomy of an App Repo

An app is split into server and UI halves, plus a shared types package. Mirrors how `boringos-crm` is structured today.

```
my-crm-app/
  boringos.json                 ← manifest (root, required)
  README.md
  LICENSE
  package.json
  pnpm-workspace.yaml
  packages/
    server/
      src/
        index.ts                  ← exports AppDefinition (default)
        agents/                   ← agent definitions seeded at install
          email-triage.ts
          contact-enrichment.ts
        workflows/                ← workflow templates installed at provision
          email-ingest.ts
          calendar-check.ts
        routes/                   ← Hono routers + agentDocs
          contacts.ts
          companies.ts
          deals.ts
        context/                  ← context providers for agent prompts
          deal-context.ts
        events/                   ← event emit helpers
          deal-won.ts
        tenant.ts                 ← onTenantCreated hook
      schema/
        migrations/               ← versioned SQL migrations
          0001_init.sql
          0002_add_dossier.sql
    web/
      src/
        slots/                    ← UI slot contributions (one file per slot)
          nav.tsx
          dashboard-widgets.tsx
          entity-actions.tsx
          settings-panels.tsx
          copilot-tools.tsx
        pages/                    ← screens reachable from nav entries
          Pipeline.tsx
          Contacts.tsx
          Deals.tsx
        components/               ← shared components
        hooks/                    ← TanStack Query hooks against /api/crm/*
      dist/                       ← built UI bundle (referenced by manifest)
    shared/
      src/
        types.ts                  ← TypeScript types shared between server + web
        constants.ts
  test/
    integration/                  ← uses @boringos/app-test-harness
```

The exported `AppDefinition` (server side):

```ts
import { defineApp } from "@boringos/app-sdk";
import * as agents from "./agents";
import * as workflows from "./workflows";
import * as routes from "./routes";
import { onTenantCreated } from "./tenant";

export default defineApp({
  id: "crm",
  agents: [agents.emailTriage, agents.contactEnrichment, /* ... */],
  workflows: [workflows.emailIngest, workflows.calendarCheck],
  contextProviders: [/* ... */],
  routes: routes.register,
  onTenantCreated,
  onUpgrade: async (db, tenantId, fromVersion, toVersion) => { /* ... */ },
  onUninstall: async (db, tenantId) => { /* ... */ }
});
```

The UI half exports slot contributions:

```ts
import { defineUI } from "@boringos/app-sdk/ui";
import { PipelinePage, ContactsPage } from "./pages";
import { OpenDealsWidget, StalledDealsWidget } from "./slots/dashboard-widgets";
import { SendFollowupAction } from "./slots/entity-actions";

export default defineUI({
  pages: { pipeline: PipelinePage, contacts: ContactsPage },
  dashboardWidgets: { "open-deals": OpenDealsWidget, "stalled-deals": StalledDealsWidget },
  entityActions: { "send-followup": SendFollowupAction },
  copilotTools: { /* ... */ }
});
```

---

## 5. Hosting

**v1: all apps run in-process.** Every installed app — first-party or third-party, marketplace or GitHub-direct — runs inside the shell's Node.js process, like a WordPress plugin. App code has direct database access, can register schema migrations, and uses in-process function calls for everything.

The SDK is shaped to allow a remote dispatcher to be added later (the `AppDefinition` shape is hosting-agnostic), but no remote runtime exists in v1. Adding remote-app support is **deferred until a real third-party use case emerges** — for example, an app that needs custom infrastructure (Python ML model, GPU access), or a marketplace requirement for stronger sandboxing.

**Implications:**

- All apps must be authored in TypeScript / JavaScript (Node.js)
- All apps share the shell's process — a crashing app can affect the shell
- App updates require shell restart (acceptable at current scale)
- Sandboxing is via capability scopes + code review, not process isolation

**When remote becomes warranted (future):**

- A specific third-party app needs custom infra we don't want to host
- The marketplace expands to apps from publishers we cannot fully audit
- Cross-tenant isolation requirements demand process boundaries

Until then, in-process keeps the platform simple, fast, and shippable.

---

## 6. Building Locally

### Scaffold

```
npx create-businessos-app my-crm
cd my-crm
```

Generates the repo structure above with placeholder schema, one agent, one workflow, one nav entry, and one entity action — all wired end-to-end. You start with a working empty app, not a blank page.

### Local dev loop

```
pnpm install
pnpm dev
```

This:

1. Spins up a local BoringOS shell sandbox
2. Provisions a fresh tenant
3. Installs your app (running migrations, seeding agents, mounting routes, loading UI slots)
4. Watches for changes — schema, server, UI all hot-reload independently

You can iterate on a slot component and see it update live without re-installing the app. Schema changes prompt you to write a migration.

### Testing

```
pnpm test
```

Uses `@boringos/app-test-harness`:

- Spawns an isolated test tenant per test
- Lets you assert against agent runs, workflow executions, route responses, slot rendering
- Validates the manifest and capability declarations against the actual code
- Confirms migrations apply forward and roll back cleanly

A test that registers an agent that wasn't declared in the manifest fails. A route that emits an event under a namespace not listed in `events:emit` fails. The harness enforces the contract.

---

## 7. Publishing

Two paths, same as connectors. Reference: [Publishing & Install](./publishing-and-install.md).

### Path A — GitHub-as-registry (raw install)

For private apps, internal-only builds, beta releases.

1. Push to GitHub, tag `v1.0.0`
2. Release artifact must include `boringos.json`, server `dist/`, UI `dist/`, and `schema/migrations/`
3. Tenant pastes the GitHub URL → shell fetches manifest → permission prompt → install

GitHub-direct apps always run **remote**. In-process hosting requires marketplace approval.

### Path B — Marketplace listing (vetted)

For public distribution.

```
npx businessos publish
```

Same flow as connectors plus extra checks:

- Schema migrations validated forward + backward
- UI bundle size enforced (slot components must be lazy-loadable)
- Cross-app dependencies declared and acyclic
- Capability declarations match actual SDK calls in the bundle

Apps requesting `entities.{other_app}:read` go through human review of the cross-app justification.

---

## 8. One-Click Install (User Perspective)

When a user installs CRM:

```
CRM by BoringOS · verified

This app requests permission to:
  ✦ Create and manage its own data (3 entity types: contacts, companies, deals)
  ✦ Read and write tasks
  ✦ Read and submit inbox items
  ✦ Register 5 agents (Email Triage, Contact Enrichment, Company Enrichment,
                     Deal Analyst, Follow-up Writer)
  ✦ Register 2 workflow templates (Email Ingest, Calendar Check)
  ✦ Add 3 nav entries (Pipeline, Contacts, Companies)
  ✦ Add 2 dashboard widgets
  ✦ Use your Google connector (Gmail read + Calendar read)
  ✦ Write to memory

[Cancel]              [Install]
```

On approve:

1. Schema migrations run inside a transaction
2. `onTenantCreated` executes — agents seeded, workflows installed, default data created
3. Routes mount at `/api/crm/*`
4. UI bundle lazy-loads; nav entries appear in the sidebar
5. Copilot picks up the app's `agentDocs` automatically; new questions about deals/contacts now work
6. App appears in the user's installed list with status **Active**

Cross-app dependency flow: when Accounts is installed and declares `entities.crm:read`, the user is told *"Accounts needs to read CRM deals to generate invoices — CRM is already installed, approve this link?"* before install completes.

---

## 9. Capabilities & Security

Apps request a much broader capability set than connectors. The full catalog is in [capabilities.md](../capabilities.md). Key categories:

| Category        | Examples                                              |
| --------------- | ----------------------------------------------------- |
| `entities.*`    | `entities.own:write`, `entities.crm:read`             |
| `agents.*`      | `agents:register`, `agents:wake`                      |
| `workflows.*`   | `workflows:register`, `workflows:trigger`             |
| `events.*`      | `events:emit:crm.*`, `events:subscribe:inbox.*`       |
| `slots.*`       | `slots:nav`, `slots:dashboard.widget`, `slots:copilot.tool` |
| `connectors.*`  | `connectors:use:google`, `connectors:use:slack`       |
| `inbox.*`       | `inbox:read`, `inbox:write`                           |
| `memory.*`      | `memory:read`, `memory:write`                         |

Apps **cannot**:

- Read or write to other apps' entities without declared dependency + user approval
- Modify shell-owned tables (auth, tenant, agent runtime tables)
- Disable other apps
- Bypass capability checks (the SDK enforces them at runtime, the marketplace verifies them at publish)

### Security review (marketplace path only)

In addition to connector checks:

- Schema review (no shadowing of shell tables, no unbounded text columns without indexing)
- Agent review (no agents requesting unaudited tools, no unbounded budgets)
- UI review (no XSS in slot components, sandboxing for remote-rendered components)
- Cross-app dependency review

---

## 10. Versioning & Updates

Apps are versioned more carefully than connectors because schema migrations are involved.

| Change type                                                     | Semver bump |
| --------------------------------------------------------------- | ----------- |
| Bug fix, no schema change, no API change                        | patch       |
| Additive schema change (new column, new table), new agent, new workflow | minor       |
| Removed entity, breaking schema migration, capability change, removed slot contribution | major       |

**Major upgrades require explicit user approval** with a diff of permissions before and after. Migrations run inside transactions; on failure, the app stays at the prior version.

**Schema migrations** are forward-only by default. Backward migrations are supported but discouraged — uninstall + reinstall is the safer path for major rollbacks.

**Deprecated apps** are flagged in the marketplace; a 90-day sunset period applies before existing installs are forced to migrate or uninstall.

---

## 11. Examples

| App                            | What to learn from it                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `@boringos-crm`                | Reference implementation. Schema, agents, workflows, slots, context providers — all wired end-to-end |
| (future) `@boringos-accounts`  | Cross-app entity reads (CRM deals → invoices); event-driven workflows           |
| (future) `@boringos-hr`        | Canonical employee entity; integration with Calendar + Slack connectors         |

---

## 12. Reading Order From Here

- [Publishing & Install](./publishing-and-install.md) — registry mechanics, signed bundles, update flows
- [App SDK Reference](../app-sdk.md) — full type definitions, slot APIs, lifecycle hooks
- [Capabilities](../capabilities.md) — the full capability scope catalog
- [Building Connectors](./building-connectors.md) — when an integration is what you actually need

---

*Last updated: 2026-04-30*

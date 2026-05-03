# Phase 1 — Ship BusinessOS v1

> Build the platform: shell + App SDK + connector migration + apps lifecycle + default apps.

**Goal:** A fresh tenant can sign up, install an app from a GitHub URL, and have it work end-to-end. The shell is usable on its own (zero apps installed) and apps are pluggable.

**Phase 1 Gate:** All five workstreams pass their acceptance checks. CI verifies that any connector or app's manifest matches its code.

**Out of scope:** Marketplace UI, billing, public dev portal, remote-app runtime. Those are Phase 4+.

---

## Workstreams

| Code | Workstream | Tasks | Estimate |
|---|---|---|---|
| **B** | App SDK | 5 (B1–B5) | 3 days |
| **D** | Connector migration | 4 (D1–D4) | 4 days |
| **A** | Shell extraction | 8 (A1–A8) | 2–3 weeks |
| **C** | Apps lifecycle + registry | 7 (C1–C7) | 1–1.5 weeks |
| **E** | First-party default apps | 4 (E1–E4) | 3–4 days |

**Total:** 28 tasks, ~5–7 weeks of focused engineering.

---

## Order of attack

Front-load the risky stuff. Don't go in pure dependency order.

```
1. B1–B5   App SDK published                          ← contract foundation
2. D1, D2  Manifest schema + Slack migration          ← contract validation
   ▲ stop and reassess if D2 is hard
3. D3–D4   Google migration + CI verification         ← parallel with A
4. A1–A8   Shell extraction (parallel with C)
5. C1–C7   Apps lifecycle (depends on A)
6. E1–E4   Default apps (depends on C)
```

**The unlock:** D2 (Slack migrated cleanly to manifest format) is the moment you know whether the SDK is right. If Slack migrates cleanly, A and C are safe to start. If Slack migration gets ugly, fix B before doing anything else.

---

## Workstream B — App SDK (5 tasks)

The contract everything else depends on. Build first.

| Task | Goal |
|---|---|
| **B1** | Create `packages/@boringos/app-sdk/` skeleton (package.json, tsconfig, build) |
| **B2** | Define `ConnectorManifest` and `AppManifest` types per Phase 0 naming (`kind`, `id`, `type`, `name`) |
| **B3** | Implement `defineApp`, `defineConnector`, `defineUI` helpers |
| **B4** | Define slot type interfaces, `ContextBuildContext`, `LifecycleContext` |
| **B5** | Publish `@boringos/app-sdk@1.0.0-alpha.0` and `@boringos/connector-sdk@1.0.0-alpha.0` |

**Acceptance:** Both packages compile, type-check, and are publishable. A consumer can `import { defineApp } from "@boringos/app-sdk"` and get a fully-typed builder.

---

## Workstream D — Connector migration (4 tasks)

Validates the SDK against real existing code. **Don't proceed past D2 if migration is ugly.**

| Task | Goal |
|---|---|
| **D1** | JSON Schema for the `businessos.json` manifest itself (validates connector + app manifests) |
| **D2** | Migrate `@boringos/connector-slack` to manifest format. Add `businessos.json`, JSON Schema for actions, capability declarations |
| **D3** | Migrate `@boringos/connector-google` (Gmail + Calendar combined) |
| **D4** | CI verification job: manifest declarations match `ConnectorDefinition` exports; emitted events under declared namespaces; outbound network only to declared domains |

**Acceptance:** Slack and Google connectors pass CI verification. Their manifests are valid against the v1 manifest schema.

**Decision points already settled (Phase 0):**

- Field names: `kind` (extension type), `id` (instance), `type` (events), `name` (actions)
- Action I/O: JSON Schema (migrating from `ActionFieldDef`)
- Hosting: in-process only (single mode for v1)

---

## Workstream A — Shell extraction (8 tasks)

The biggest workstream by volume. Lift the shell out of `boringos-crm/packages/web` into `@boringos/shell`.

| Task | Goal |
|---|---|
| **A1** | Create `packages/@boringos/shell/` skeleton (package.json, vite, React) |
| **A2** | Define slot type contracts (`NavSlot`, `DashboardWidget`, `EntityAction`, `EntityDetailPanel`, `SettingsPanel`, `CommandAction`, `CopilotTool`, `InboxHandler`) |
| **A3** | Move `Layout`, `Sidebar`, `CommandBar` from CRM web → shell |
| **A4** | Move `Login`, `Signup`, auth screens |
| **A5** | Move shared screens (Brief→Home, Copilot, Inbox, Tasks, Agents, Workflows, Settings) |
| **A6** | Implement slot registration runtime (apps register at install; shell renders contributions) |
| **A7** | Implement Apps screen (Browse + Installed + Updates + Install from URL tabs) |
| **A8** | Strip CRM web of all moved code (one PR in `boringos-crm`) |

**Acceptance:** `pnpm dev` in `packages/@boringos/shell` boots a usable shell with no apps installed. Sidebar, Copilot, Inbox, Tasks, Workflows, Settings all work. Apps screen renders empty installed list and supports Install from URL.

---

## Workstream C — Apps lifecycle + registry (7 tasks)

Database tables, install pipeline, manifest validator, permission prompt.

| Task | Goal |
|---|---|
| **C1** | Migration: `tenant_apps` table (id, tenant_id, version, status, capabilities, installed_at) |
| **C2** | Migration: `tenant_app_links` table (cross-app dependency record) |
| **C3** | Manifest fetcher: GitHub URL → fetch `businessos.json` + bundle |
| **C4** | Manifest validator (schema check + capability honesty check) |
| **C5** | Install pipeline (atomic transaction: migrations, agents, routes, slots, `onTenantCreated`) |
| **C6** | Uninstall pipeline (soft + hard variants, retention period) |
| **C7** | Permission prompt component (renders manifest capabilities; tenant approves) |

**Acceptance:** A user can paste a GitHub URL into "Install from URL", see the permission prompt, approve, and have the app fully installed and functional. Uninstall reverses the install cleanly.

---

## Workstream E — First-party default apps (4 tasks)

Without these, the shell is empty out of the box.

| Task | Goal |
|---|---|
| **E1** | Build `apps/generic-triage/` using `@boringos/app-sdk`. Subscribes to `inbox.item_created`, classifies, scores, attaches metadata |
| **E2** | Build `apps/generic-replier/` using same SDK. Drafts a generic reply suggestion when no domain-specific app does |
| **E3** | Pre-install both at tenant provision (via existing `onTenantCreated` hook) |
| **E4** | Migrate CRM Email Triage logic out of CRM into Generic Triage where appropriate (the generic split discussed in coordination.md) |

**Acceptance:** A fresh tenant has both apps installed. Connecting Gmail produces inbox items that get classified by Triage and reply suggestions from Replier. Disabling either workflow stops just that workflow.

---

## Phase 1 Exit Criteria

All four hold:

1. **`@boringos/app-sdk@1.0.0-alpha.0`** published to npm
2. **Slack and Google connectors** migrated, CI verification passes
3. **Shell boots usably** with zero apps; with both default apps pre-installed
4. **GitHub-URL install** works end-to-end for a hypothetical third-party app

When all four pass, Phase 2 (CRM port) begins.

---

## Risks (re-stated from earlier discussion)

- **Shell extraction is bigger than it looks** — CRM's web package has 25+ components and a lot of implicit shell-shaped logic. Budget 3 weeks for A, not 1.
- **The "third-party shaped app" test is the real gate** — if you can't ship a tiny app from the SDK alone (E2 is essentially this test), the platform isn't pluggable. Polish elsewhere won't fix it.
- **Connector migration ugliness is a contract bug** — if D2 is hard, fix B before continuing.

---

*Last updated: 2026-05-03*

# Shell Screens

> What ships with the BusinessOS shell, screen by screen, before any app is installed.

The shell is fully usable on its own — like a vanilla WordPress install. This doc enumerates every screen, what it does, what data it surfaces, and what slots apps can contribute to.

**Audience:** Shell developers, app developers (to see where their slots land), product reviewers.
**Read first:** [Overview](./overview.md), [App SDK Reference](./app-sdk.md).

---

## 1. The Shell Layout

Every screen renders inside a shared layout:

```
┌────────────────────────────────────────────────────────────────┐
│  [Logo]  [Command bar (Cmd+K)]            [Notifications] [User] │
├──────────┬─────────────────────────────────────────────────────┤
│          │                                                     │
│          │                                                     │
│ Sidebar  │                Main content area                    │
│ Nav      │                                                     │
│          │                                                     │
│          │                                                     │
│          ├─────────────────────────────────────────────────────┤
│          │              Copilot dock (collapsible)             │
└──────────┴─────────────────────────────────────────────────────┘
```

Persistent across every screen:

- **Top bar** — logo, command bar (`Cmd+K`), notifications, user menu
- **Sidebar** — nav with shell entries + app contributions (sorted by `order`)
- **Copilot dock** — always-on conversation; expands as a pane, collapses to a button

Apps cannot replace the layout. They contribute *into* it via slots.

---

## 2. Screens at a Glance

| Screen        | Purpose                                                 | Slot contributions accepted                                           |
| ------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Home          | Daily brief, dashboard, today's work                    | `dashboard.widget`                                                    |
| Copilot       | Always-on agentic thread                                | `copilot.tool`                                                        |
| Inbox         | Unified stream of emails / messages / app items         | `inbox.handler`                                                       |
| Tasks         | Full task model (list + detail)                         | (none — but apps can create tasks via SDK)                            |
| Agents        | Manage agents and personas                              | (none directly — apps register agents via manifest)                    |
| Workflows     | DAG editor, run viewer                                  | `workflows.blocks` (custom block types)                                |
| Drive         | File storage with memory sync                           | (none v1)                                                             |
| Connectors    | OAuth + connector status                                | (none — connectors install themselves)                                 |
| Apps          | Marketplace + installed apps                            | (this is where install / uninstall happens)                            |
| Team          | Users, roles, invites                                   | (none v1)                                                             |
| Settings      | Tenant config, branding, billing                        | `settings.panel` (per-app config)                                      |
| Activity      | Audit log of agent runs and actions                     | (filtered views — apps don't contribute UI here)                       |
| Approvals     | Pending agent approvals                                 | (none directly — apps surface approvals via SDK)                       |

In addition, every entity detail view (e.g. a CRM Contact, a CRM Deal, an Accounts Invoice) accepts:

- `entity.detail` (tabs / panels)
- `entity.action` (buttons / actions on the record)

Entity detail views are *defined by apps* but rendered by the shell's entity framework, which is why other apps can extend them.

---

## 3. Home

The first screen after login. WP-Dashboard analog.

**Sections:**

- **Greeting + brief.** "Good morning. 4 tasks due today, 2 deals stalled, 1 approval waiting."
- **Today's tasks.** Filtered to assignee = current user, due date ≤ today.
- **Recent activity.** Agent runs that completed in last 24h. Click → activity log.
- **Open approvals.** Pending agent approvals.
- **Dashboard widgets.** Grid of app-contributed widgets, three columns, sortable.

**Empty state (zero apps installed):** "Connect a tool to get started" — link to Connectors. "Install your first app" — link to Apps.

**Slot:** `dashboard.widget` — apps add tiles here. Sizes: small (1 col), medium (2 col), large (full width).

---

## 4. Copilot

The headline UX. Always-on agentic thread.

**Behavior:**

- Single persistent thread per user, scrollable history
- Messages: user input, agent reasoning steps (collapsed by default), tool invocations, results
- Files, images, screenshots can be dropped in; routed through Drive
- Multi-turn — copilot remembers context across the entire thread
- Agent picks up `agentDocs` from every installed app — so capability grows with app installs

**Multi-thread mode (advanced):** users can spawn additional named threads (e.g. "Q3 planning", "Acme deal") for parallel work.

**Slot:** `copilot.tool` — apps register named tools (with input/output schemas) the copilot can invoke. CRM exposes `create_deal`, `lookup_contact`. Accounts exposes `draft_invoice`.

**Composition with apps:** copilot is always one screen. It does not become "the CRM copilot" or "the Accounts copilot." It's one entity that reasons across all installed apps simultaneously.

---

## 5. Inbox

Unified stream across connectors and apps.

**Sources of items:**

- Emails (via Gmail connector)
- Slack DMs and channel mentions (via Slack connector)
- Calendar invites and meeting reminders (via Calendar connector)
- App-submitted items (via `inbox:write`)
- Webhook payloads (via plugin webhooks)

**View:**

- Stream view: chronological, filterable by source, status, label
- Detail view: full content, linked entity (if any), actions
- Triage actions: read, snooze, assign, link to entity, archive
- Bulk select + bulk actions

**Ownership rule:** the shell creates exactly **one inbox item per source event** (email, Slack message, webhook payload). Apps **enrich** the existing item — link to a Contact, tag with a Deal, attach intent — they never create parallel items for the same source. Apps subscribe to `inbox.item_created`, never to raw connector events. See [coordination.md](./coordination.md).

**Slot:** `inbox.handler` — **UI rendering only.** Apps contribute custom rendering and per-item actions on the inbox screen. This slot does *not* wake agents; agent waking is via workflows that subscribe to `inbox.item_created`. Multiple handlers can match a single item; user picks which to apply.

**Suggestions are list-shaped.** When multiple apps each contribute a reply draft / suggested action / linked entity, all suggestions appear in a list on the item. The user picks one; there is no platform-level priority resolution.

**Empty state (no connectors):** "Connect Gmail or Slack to start receiving."

---

## 6. Tasks

Full task model, exposed as a screen.

**List view:**

- Filterable: assignee, status, priority, label, due date, parent
- Group by: assignee, status, due date, project
- Bulk actions: assign, status change, label add/remove

**Detail view:**

- Title, description, status, priority, assignee, due date, parent task, labels
- Comment thread (humans + agents post here)
- Work products (artifacts produced by agent runs)
- Sub-tasks (nested)
- Activity timeline (every state change)
- "Wake agent" button — triggers a session against this task

**Slot:** none directly. Apps create tasks via `tasks.create()` (requires `entities.core:write`).

---

## 7. Agents

Manage the agent population.

**List view:**

- Name, persona, runtime, status (idle / running / paused), trigger summary
- Filter: app source (shell-default vs CRM-registered vs Accounts-registered)

**Detail view:**

- Persona, runtime binding, instructions
- Triggers (events subscribed, schedules)
- Hierarchy (reports-to, subordinates)
- Budget (used / limit, time window)
- Recent runs (last 50)
- Memory usage (entries written/read by this agent)
- Manual wake button

**Empty state:** "Create your first agent" or "Install an app to get pre-built agents."

**Slot:** apps register agents via `agents:register` capability. Agents appear here automatically; users can edit instructions but not core fields.

---

## 8. Workflows

DAG editor and run viewer.

**List view:**

- Workflow templates (installed, ready to run)
- Active workflows (currently running)
- Recent runs

**Editor:**

- Drag-and-drop DAG canvas (xyflow + dagre)
- Block palette: 9 native block types (trigger, condition, delay, transform, wake-agent, connector-action, for-each, create-inbox-item, emit-event) + any app-registered blocks
- Block config form per block
- Save / publish / disable

**Run detail:**

- Visual DAG with run status overlaid (each block green/yellow/red)
- Per-block input/output, duration, errors
- Diff view between runs of the same workflow

**Slot:** `workflows.blocks` — apps register custom block types. CRM might add "Update deal stage"; Accounts might add "Draft invoice".

---

## 9. Drive

File storage with memory sync.

**View:**

- File browser (folders, files, search)
- Upload, download, rename, delete
- Per-file: indexing status, memory sync status
- Share / permissions (within tenant)

**Memory sync:** every uploaded file is parsed, sectioned, and indexed into the tenant's memory provider. Agents can search and recall.

**Slot:** none in v1.

---

## 10. Connectors

OAuth + status for integration plumbing.

**View:**

- Installed connectors with status (Connected / Disconnected / Error)
- Per-connector: scopes granted, last sync, recent errors
- Reconnect / disconnect actions
- Browse available connectors (links to Apps screen → Connectors filter)

**Empty state:** "Connect Google to enable Gmail and Calendar." Inline OAuth buttons for shell-bundled connectors.

---

## 11. Apps

Marketplace + installed app management. The most important screen for the platform thesis.

**Tabs:**

- **Browse** — marketplace listings, filterable by category (CRM, Accounts, HR, Sales, Finance, Productivity), free vs paid, publisher
- **Installed** — apps currently installed in this tenant, with status (Active / Paused / Updates available)
- **Updates** — apps with available updates, grouped by channel
- **Install from URL** — paste a GitHub URL for direct install (advanced)

**Listing card:**

- Name + icon, publisher (with verified badge), short description
- Install count, average rating, last updated
- Capabilities at a glance (icons + count; click for full list)
- Install button (or Open / Manage if already installed)

**Listing detail:**

- Long description, screenshots
- Full capability list (with explanations)
- Changelog
- Pricing (if any)
- Source link (if open source)
- Reviews

**Install flow:** see [Publishing & Install](./developer/publishing-and-install.md). Permission prompt → approve → progress → app entries appear.

**Uninstall flow:** Manage → Uninstall → choose Soft (30-day retention) or Hard (immediate drop) → confirm → app entries disappear.

---

## 12. Team

Users, roles, invites.

**View:**

- User list with role (Admin / Member / Custom)
- Invite by email (sends invite link, 7-day expiry)
- Pending invitations
- Per-user: change role, remove, see activity
- Custom roles (Admin tier only): define scoped permissions

---

## 13. Settings

Tenant configuration.

**Sections:**

- **General** — tenant name, logo, timezone, default currency
- **Branding** — primary color, custom logo on shell (Pro tier)
- **Billing** — plan, payment method, invoices, usage metrics
- **Security** — SSO config, audit log retention, IP allowlist
- **API keys** — generate / rotate / revoke admin tokens
- **Webhook URLs** — show the per-tenant webhook endpoints
- **App settings** — one panel per installed app via `settings.panel` slot

**Slot:** `settings.panel` — apps contribute their config UI here. CRM contributes "Pipeline configuration"; Accounts contributes "Chart of accounts."

---

## 14. Activity

Audit log.

**View:**

- Chronological stream of: agent runs, task mutations, connector events, app installs/uninstalls, capability denials, webhook deliveries
- Filterable by: actor (user / agent / app), type, time range, tenant scope
- Per-entry: full payload (JSON), correlation id, related entities

Used for debugging, compliance, and forensics.

---

## 15. Approvals

Pending agent approvals.

**View:**

- Stream of approval requests (agent paused mid-run, asking for human go-ahead)
- Per-request: agent name, what it's about to do (action description, payload preview), task context
- Actions: Approve, Reject (with reason), Defer
- Approval triggers session resume; rejection terminates the run

This is the human-in-the-loop choke point for agentic work.

---

## 16. Entity Detail Pages

Every entity type registered by an installed app gets a detail page in the shell. The framework provides the chrome (header, breadcrumbs, action bar); the app provides the content via slots.

**Layout:**

- Header — entity name, status, owner
- Action bar — buttons from `entity.action` slot (every app that registered actions for this entity type contributes here)
- Tabs — overview (default), plus tabs from `entity.detail` slot
- Right rail — related items (tasks, inbox items linked to this entity), recent activity

**Cross-app extension example:** CRM defines `crm_contact`. Accounts can register a "Billing history" tab for `crm_contact` if both apps are installed and the user approved the cross-app dependency. Same entity page, two apps contributing.

---

## 17. Auth Screens

- Login (email/password, magic link, SSO)
- Signup (with `tenantName` for new tenant or `inviteCode` for existing)
- Device auth (GitHub-style flow for CLI / mobile / desktop apps that need to authenticate without a browser)
- Forgot password / reset

These are pre-authentication; not part of the shell's authenticated layout.

---

## 18. What the Shell Deliberately Does Not Ship

- A CRM (it's an installable app)
- An accounting package (installable app)
- A help-desk / ticketing system (installable app)
- A custom report builder (could be an app)
- A document editor (Drive ships file storage; editing is delegated to native apps or future installable apps)

Anything domain-specific is an app. The shell stays minimal and reusable.

---

## 19. Reading Order From Here

- [App SDK Reference](./app-sdk.md) — slot type definitions
- [Capabilities](./capabilities.md) — what slot contributions require to be granted
- [Building Apps](./developer/building-apps.md) — applied guide for contributing to slots

---

*Last updated: 2026-04-30*

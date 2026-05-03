# Capabilities

> The full catalog of permission scopes an extension can request, what each unlocks, and how they're enforced.

Capabilities are the OAuth-style permission model. Extensions declare what they need; tenants grant on install. The SDK enforces them at runtime; the marketplace verifies them at publish.

**Audience:** Developers writing manifests; security reviewers; tenants reading install prompts.
**Read first:** [App SDK Reference](./app-sdk.md).

---

## 1. The Model

Three principles:

1. **Declared, not granted by default.** Every capability must appear in the manifest. Undeclared SDK calls fail at runtime and fail review at publish.
2. **Granted by the tenant, not the platform.** The shell shows a permission prompt at install. Tenant approves or declines. Some capabilities can be dropped individually.
3. **Scoped to the extension.** A capability granted to CRM does not flow to Accounts. Cross-app access is its own capability with its own approval.

---

## 2. Capability Naming Convention

```
{category}.{subject}:{action}
```

Examples:

- `entities.own:write` — write to entities owned by this extension
- `entities.crm:read` — read entities owned by the CRM app
- `events:emit:crm.*` — emit events under the `crm.` namespace
- `slots:nav` — contribute to the nav slot
- `connectors:use:google` — invoke Google connector actions

Wildcards (`*`) are allowed in event namespaces only.

---

## 3. The Categories

### `entities.*` — Data access

| Capability                       | Meaning                                                                                  | Auto / Tenant-approved |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `entities.own:read`              | Read the extension's own namespaced tables                                                | Auto                   |
| `entities.own:write`             | Write to the extension's own namespaced tables                                            | Auto                   |
| `entities.core:read`             | Read shell-owned entities (tasks, inbox, drive, memory)                                   | Tenant-approved        |
| `entities.core:write`            | Write to shell-owned entities (create tasks, submit inbox items, etc.)                    | Tenant-approved        |
| `entities.{other_app}:read`      | Read another installed app's entities (requires that app's manifest to declare it shareable) | Tenant-approved + cross-app review |
| `entities.{other_app}:write`     | Write to another app's entities                                                            | Human review required  |

### `agents.*` — Agent runtime

| Capability                   | Meaning                                                            | Auto / Tenant-approved |
| ---------------------------- | ------------------------------------------------------------------ | ---------------------- |
| `agents:register`            | Seed named agents at install                                       | Tenant-approved        |
| `agents:wake`                | Programmatically wake an agent from a route or event handler       | Tenant-approved        |
| `agents:budget:custom`       | Override default budget caps on registered agents                  | Human review required  |
| `agents:hierarchy`           | Create agent reports-to relationships across the tenant            | Tenant-approved        |

### `workflows.*` — DAG orchestration

| Capability                   | Meaning                                                          | Auto / Tenant-approved |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `workflows:register`         | Install workflow templates at tenant provision                   | Tenant-approved        |
| `workflows:trigger`          | Programmatically trigger workflow runs                           | Tenant-approved        |
| `workflows:blocks:register`  | Register custom DAG block types                                  | Tenant-approved + review |

### `events.*` — Event bus

| Capability                       | Meaning                                                                       | Auto / Tenant-approved |
| -------------------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| `events:emit:{namespace}`        | Emit events under the named namespace; `crm.*` for the CRM app                | Auto for own namespace; review for others |
| `events:subscribe:{namespace}`   | Subscribe to events under a namespace                                          | Tenant-approved        |
| `events:subscribe:connector.*`   | Subscribe to all connector events                                              | Tenant-approved        |

### `slots.*` — UI contributions

| Capability                   | Meaning                                                       | Auto / Tenant-approved |
| ---------------------------- | ------------------------------------------------------------- | ---------------------- |
| `slots:nav`                  | Add entries to the sidebar nav                                | Auto (capped count)    |
| `slots:dashboard.widget`     | Add widgets to the Home dashboard                             | Auto (capped count)    |
| `slots:entity.detail`        | Add tabs / panels to entity detail views                      | Tenant-approved        |
| `slots:entity.action`        | Add actions to entity records                                 | Tenant-approved        |
| `slots:settings.panel`       | Add a settings panel for the app                              | Auto                   |
| `slots:command.action`       | Add commands to the global command bar                        | Auto (capped count)    |
| `slots:copilot.tool`         | Register tools the copilot can invoke                         | Tenant-approved        |
| `slots:inbox.handler`        | Register inbox item handlers                                  | Tenant-approved        |

Caps prevent extension spam: an app can add up to 5 nav entries, 4 dashboard widgets, 10 command actions by default. Exceeding requires human review.

### `connectors.*` — Integration plumbing

| Capability                           | Meaning                                                          | Auto / Tenant-approved |
| ------------------------------------ | ---------------------------------------------------------------- | ---------------------- |
| `connectors:use:{connector_id}`      | Invoke actions on the named connector                            | Tenant-approved        |
| `connectors:register`                | Register a brand-new connector (apps that bundle their own)      | Human review required  |

### `inbox.*` — Unified inbox

| Capability                   | Meaning                                                       | Auto / Tenant-approved |
| ---------------------------- | ------------------------------------------------------------- | ---------------------- |
| `inbox:read`                 | Read the unified inbox stream                                 | Tenant-approved        |
| `inbox:write`                | Submit items into the unified inbox                           | Tenant-approved        |
| `inbox:claim`                | Claim/assign inbox items programmatically                     | Tenant-approved        |

### `memory.*` — Persistent memory

| Capability                   | Meaning                                                       | Auto / Tenant-approved |
| ---------------------------- | ------------------------------------------------------------- | ---------------------- |
| `memory:read`                | Recall from the tenant's memory provider                      | Tenant-approved        |
| `memory:write`               | Persist new memories                                          | Tenant-approved        |
| `memory:scope:tenant`        | Read/write at tenant scope (default scope is per-app)         | Tenant-approved        |

### `network.*` — Outbound HTTP (connectors only)

| Capability                       | Meaning                                                          | Auto / Tenant-approved |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `network:outbound:{domain}`      | Permit outbound HTTPS to a specific domain                       | Auto for declared domains; human review for non-major-cloud |
| `network:outbound:*`             | Wildcard outbound — disallowed                                   | Banned                 |

Connectors must declare every domain they call. Apps cannot declare network capabilities — they reach external services through connectors.

### `auth.*` — Authentication (connectors only)

| Capability                       | Meaning                                                          | Auto / Tenant-approved |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `auth:oauth:{provider}`          | Run OAuth2 flow with a named provider                            | Tenant-approved        |
| `auth:apikey`                    | Store user-provided API key                                      | Tenant-approved        |

---

## 4. Auto-Granted vs Tenant-Approved vs Human-Reviewed

| Tier                  | Examples                                       | Install UX                                                           |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| **Auto-granted**      | `entities.own:*`, `slots:nav` (within cap)     | Not shown on install prompt; assumed for any extension                |
| **Tenant-approved**   | `entities.core:*`, `agents:register`, `connectors:use:*`, most slots | Shown on install prompt; tenant can approve or decline; some can be individually dropped |
| **Human-reviewed**    | `entities.{other_app}:write`, `connectors:register`, `agents:budget:custom`, in-process hosting | Cannot ship via marketplace without human reviewer sign-off |

---

## 5. The Permission Prompt

What a user sees at install:

```
CRM by BoringOS · verified

This app requests permission to:

  Data
    ✦ Create and manage its own entities (3 types: contacts, companies, deals)
    ✦ Read and write tasks
    ✦ Read and submit inbox items

  Agents & workflows
    ✦ Register 5 agents
    ✦ Register 2 workflow templates
    ✦ Wake agents from events

  UI
    ✦ Add 3 nav entries
    ✦ Add 2 dashboard widgets
    ✦ Add actions to deal records
    ✦ Register 4 copilot tools

  Integrations
    ✦ Use your Google connector

  Memory
    ✦ Read and write tenant memory

[ ▼ Show all 17 capabilities ]

[Cancel]              [Install]
```

Capabilities grouped for legibility, not by raw scope name. The "Show all" expansion shows the underlying capability strings for power users and reviewers.

---

## 6. Cross-App Capability Resolution

When app B declares `entities.A:read`:

1. The B manifest must list `entities.A:read` in its capabilities
2. The A manifest must declare its entities as shareable: `entityTypes[i].shareable: true`
3. At install time, the user is prompted: *"Accounts needs to read CRM deals to generate invoices. CRM is installed; approve this link?"*
4. On approval, B can read A's entities until either is uninstalled

The dependency is recorded in `tenant_app_links`. Uninstalling A surfaces the dependency to the user before proceeding.

---

## 7. Runtime Enforcement

Every SDK call checks capabilities before executing:

```ts
// app-sdk internal
function requireCapability(extId: string, cap: string) {
  if (!installed[extId].capabilities.includes(cap)) {
    throw new CapabilityDeniedError(extId, cap);
  }
}
```

Examples in practice:

| SDK call                                | Capability checked              |
| --------------------------------------- | ------------------------------- |
| `db.insert("crm_contacts", row)`        | `entities.own:write`            |
| `ctx.emit("crm.deal_won", payload)`     | `events:emit:crm.*`             |
| `tasks.create(...)`                     | `entities.core:write`           |
| `inbox.read({ ... })`                   | `inbox:read`                    |
| `useConnector("google").list_emails()`  | `connectors:use:google`         |
| `memory.write("foo", data)`             | `memory:write`                  |

`CapabilityDeniedError` is logged with extension id, capability, and call site. Surfaces in the Activity log; flagged in security review on next publish.

---

## 8. Publish-Time Verification

Marketplace review (and `pnpm test` locally) runs static analysis:

- Bundle is parsed; every SDK call is identified
- The required capability for each call is computed
- The set of required capabilities is compared against the manifest's declared `capabilities`
- Any required-but-undeclared capability fails the publish
- Any declared-but-unused capability raises a warning (encourages minimal scopes)

This means: **what the manifest claims must equal what the code does.** No more, no less.

---

## 9. Capability Diff on Update

Major version updates that change capabilities trigger a re-consent prompt. Diff format:

```
CRM v2.0.0 — capability changes

  Added:
    + entities.accounts:read   (cross-app: read Accounts invoices)
    + slots:inbox.handler

  Removed:
    − connectors:use:slack

[Cancel update]   [Approve and update]
```

Users can decline; the app stays at the prior version.

---

## 10. Banned / Reserved

| Scope                   | Status   | Reason                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------- |
| `network:outbound:*`    | Banned   | Wildcard exfiltration risk                                          |
| `entities.shell:write`  | Banned   | Shell tables (auth, tenant, runtime) cannot be written by extensions |
| `agents:disable:*`      | Banned   | Apps cannot disable other apps' agents                              |
| `events:emit:shell.*`   | Banned   | Shell events are emitted by the runtime, not by extensions          |
| `_*`                    | Reserved | Underscore-prefixed scopes are platform-internal                    |

---

## 11. Reading Order From Here

- [App SDK Reference](./app-sdk.md) — type definitions for every capability-checked call
- [Building Apps](./developer/building-apps.md) — applied guide
- [Publishing & Install](./developer/publishing-and-install.md) — review process detail

---

*Last updated: 2026-04-30*

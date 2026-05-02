# Coordination

> How shell and apps coordinate at runtime — what flows through events, what flows through workflows, and why the shell never needs to know which apps exist.

This doc captures the runtime flow model: how a single event (an email arriving) becomes the right work happening in the right places, without the shell having a single line of code that mentions any specific app.

**Audience:** App developers designing event subscriptions; platform team wiring runtime; reviewers checking the architecture.
**Read first:** [Overview](./overview.md), [Shell Screens](./shell-screens.md), [App SDK Reference](./app-sdk.md).

---

## 1. The Coordination Substrate

Coordination between the shell and apps — and between apps — happens through **two primitives**:

| Primitive | Shape | When |
|---|---|---|
| **Event bus** | pub/sub, broadcast, async, no return value | The default. The substrate. "Something happened; anyone may care." |
| **Agent handover** (`ctx.handover`) | targeted, context-rich, returns a result | Runtime escape hatch. Used only when an agent mid-reasoning needs a specialist colleague's brain on the same task and waiting is correct. |

The decision rule:

```
If the trigger is "the world changed":     events
If the trigger is "I need a colleague":    handover
Default to events.
```

Workflows are how apps **subscribe** to events. They are the only mechanism for waking agents in response to events. There is no parallel "agent waking" primitive.

`inbox.handler` (and similar slots) are **UI-only** — they describe how an item renders in the inbox screen and what custom actions appear. They do not wake agents.

---

## 2. The Shell Owns Structural Surfaces

A small number of things are structural to being the shell. They are not toggle-able and they are not implemented as apps:

- Authentication and tenancy
- The inbox table and the structural rule of one inbox item per source event
- The event bus itself
- The workflow runtime
- The agent runtime

Everything else that "the shell does" is implemented as a **first-party default app**, pre-installed, following the regular install / activate / deactivate / uninstall lifecycle.

This is the key architectural move: the shell never needs a `if (crmInstalled) { ... }` check. It doesn't know CRM exists. What look like shell behaviors are first-party default apps competing on equal footing with whatever else a tenant installs.

---

## 3. Default Behaviors Are First-Party Apps

When the platform ships, the following are pre-installed first-party apps (not shell core):

| App | What it does |
|---|---|
| **Generic Email Triage** | Classifies inbox items, scores importance, attaches metadata |
| **Generic Email Replier** | Drafts a generic reply suggestion when no domain-specific app does |
| **Generic Inbox Router** | Default rules for assigning inbox items |
| **Core Copilot Tools** | The default tool palette copilot can invoke before any app extends it |

A tenant can:

- Disable any of these (they stop running)
- Uninstall any of these (when a domain-specific replacement has it covered)
- Run them alongside other apps (they coexist, contribute alternative suggestions)

Same lifecycle as third-party apps. Same install record. Same capability declarations. The only special property is that they ship **pre-installed** at tenant provision.

This pattern generalizes: anywhere the shell would otherwise want to "know if apps exist," the answer is to ship the default behavior as a first-party app and let the regular install/uninstall mechanics decide what runs.

---

## 4. The Single-Inbox-Item Rule

When a connector emits `connector.email_received`:

1. **Shell-mandatory workflow** picks it up first and creates exactly **one inbox item** per source event. This step is structural, not an app, not toggle-able.
2. The shell saves the **full email** (headers, body, attachments) on the inbox item.
3. The shell emits `inbox.item_created` with the item id.
4. **Apps subscribe to `inbox.item_created`**, never to the raw connector event. This is the rule that prevents duplicate inbox items.
5. Apps **enrich** the item — link to a Contact, tag with a Deal, extract intent, attach a transcript. They never create parallel items for the same source.

The same rule applies to other unified surfaces — tasks, drive files, activity entries. One source event, one canonical item, many enrichers.

---

## 5. Suggestions Are List-Shaped

Apps don't fight over who gets to draft the reply. Each contributing app appends its suggestion to a **list** on the inbox item:

```
Suggested replies (3):
  • from Generic Replier: "Thanks for reaching out, we'll get back..."
  • from CRM: "Hi Sarah — saw your interest in the Pro plan. I've..."
  • from Support: "Ticket #4218 created. Our team will respond..."
```

The user picks one. There is no race, no priority resolution, no role registry needed.

The same list shape applies to:

- Suggested actions on an entity
- Suggested tasks from an inbox item
- Suggested follow-ups on a closed deal

Conflicts are resolved by the user, not by the platform. This is the WordPress-plugin coexistence model — multiple plugins can contribute, the site owner picks what to show.

---

## 6. The Email Scene, End-to-End

Worked example combining everything above.

```
Gmail connector emits `connector.email_received`
    │
    ▼  (1) Shell-mandatory workflow
Shell creates one inbox item with full email payload.
Emits `inbox.item_created`.
    │
    ▼  (2) Multiple workflows subscribe in parallel — independent, no ordering
        ├── Generic Email Triage (first-party default app)
        │     wake-agent → classifies, scores, writes metadata
        │
        ├── Generic Email Replier (first-party default app)
        │     wake-agent → drafts a generic reply, appends to suggestions list
        │
        ├── CRM Email Lens (only if CRM is installed)
        │     wake-agent → reads metadata, links to Contact, drafts CRM-aware reply
        │
        └── Accounts Invoice Extractor (only if Accounts is installed)
              wake-agent → checks for invoice attachment, drafts invoice record if found
    │
    ▼  (3) Each workflow that ran posts results
Each contributes a suggestion (reply / action / link) to the inbox item.
    │
    ▼  (4) User opens the inbox item in the shell
Sees: enrichments (classification, Contact link, Deal link), suggestions list (multiple replies), available actions.
Picks one suggestion to act on, or composes their own.
```

What's worth noting:

- The shell never checked which apps were installed
- No app called another app directly
- No "shell runs first" coupling beyond the structural inbox-item creation
- Disabling any workflow disables exactly that workflow; everything else continues
- Adding a fifth app changes nothing for the existing four

---

## 7. When Handover Is Right (And When It Isn't)

Handover is the runtime escape hatch. Use it only when:

- An agent is mid-reasoning and needs a specialist's brain on the same task
- Context is too rich to serialize cleanly into an event payload
- The caller will use the result to continue its own reasoning
- Async fan-out would be wrong because the result is a single answer the caller needs

For email, handover is the 10% case. Example: shell's Generic Triage hits an email it genuinely cannot classify and queries an installed "Domain Expert" app via handover for a one-shot opinion before continuing.

For 90% of cross-app coordination, **events are correct**. Handover is not the architecture. It's a tool inside the architecture.

---

## 8. Hierarchy, Roles, and Future Optimizations

Two things are deliberately deferred from this v1:

- **Agent hierarchy wiring.** The framework has `reportsTo`, `createHierarchyProvider`, `findDelegateForTask`, `escalateToManager` already implemented. They are unused in CRM today. Wiring them is a Phase 2 / Phase 3 concern, when manager/subordinate orchestration starts mattering across apps.
- **Role registry.** A primitive that lets apps declare "I fill the `inbox.replier` role" so other workflows can ask "is this role filled?" without enumerating apps. We don't need it for v1 — the list-of-suggestions UX makes coordination unnecessary. Introduce it as an optimization when LLM cost or UX clutter from multiple suggestions becomes a real complaint.

Neither is a blocker for the shell + first two apps. Both are listed here so they are not forgotten.

---

## 9. The Short Version

- Events are the substrate. Workflows are how apps subscribe.
- The shell creates one inbox item per source event. That is structural.
- Apps subscribe one event level higher (`inbox.item_created`), never to raw connector events.
- What looks like shell behavior is implemented as pre-installed first-party apps.
- Multiple apps contribute suggestions to a list. The user picks.
- Handover is a runtime tool, not the architecture.
- Hierarchy and role registry are deferred until they earn their complexity.

---

## 10. Reading Order From Here

- [Overview](./overview.md) — the architecture this runtime model implements
- [Shell Screens](./shell-screens.md) — what the user sees of these flows
- [App SDK Reference](./app-sdk.md) — the API for subscribing, enriching, suggesting
- [Capabilities](./capabilities.md) — the scopes that gate what apps can do at each step

---

*Last updated: 2026-05-01*

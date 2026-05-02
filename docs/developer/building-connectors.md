# Building Connectors

> A connector turns an external service into something agents in BusinessOS can read from and act on.

This guide walks through what a connector is, what it can do, how to build one, and how to publish it so any BusinessOS tenant can install it with one click.

**Audience:** Developers building integrations to external SaaS or APIs.
**Read first:** [Overview](../overview.md) — especially the architecture and core concepts.

---

## 1. What a Connector Is

A connector is the adapter layer between an external service (Stripe, HubSpot, Zendesk, Notion, your internal API) and the BusinessOS runtime. It does three things:

1. **Handles authentication** — OAuth flow, API keys, or whatever the service requires.
2. **Emits events** — translates external service events into typed events on the shell's event bus.
3. **Exposes actions** — callable functions that agents, workflows, and copilot can invoke to act on the external service.

What a connector is **not**:

- Not an app. Connectors don't ship UI, schema, or agents. Apps consume connectors.
- Not a workflow. Connectors expose primitives; workflows orchestrate them.
- Not a chatbot. Connectors return data; harnesses reason over it.

Reference implementations: [`@boringos/connector-google`](../../boringos-framework/packages/connector-google), [`@boringos/connector-slack`](../../boringos-framework/packages/connector-slack).

---

## 2. What a Connector Can Do

| Surface              | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| **Auth config**      | Declares OAuth provider, scopes, redirect handling — or a custom auth flow   |
| **Events**           | Defines typed events emitted into the shared event bus                       |
| **Actions**          | Defines named functions agents/workflows can call (with input/output types)   |
| **Webhook handlers** | Optionally receives webhooks from the external service at `/webhooks/connectors/:id/:event` |
| **Periodic sync**    | Optionally registers cron jobs to poll for changes when webhooks aren't available |

Concrete examples:

| Connector  | Events emitted                                  | Actions exposed                                                  |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Slack      | `message_received`, `mention`, `reaction_added` | `send_message`, `reply_in_thread`, `add_reaction`                |
| Gmail      | `email_received`, `email_replied`               | `list_emails`, `read_email`, `send_email`, `search_emails`       |
| Calendar   | `event_starting`, `event_created`               | `list_events`, `create_event`, `update_event`, `find_free_slots` |
| Stripe     | `payment_received`, `subscription_canceled`     | `create_invoice`, `refund_payment`, `list_customers`             |

---

## 3. The Manifest

Every connector ships a `businessos.json` at its repo root. This is the contract the shell reads at install time.

```json
{
  "kind": "connector",
  "id": "stripe",
  "version": "1.0.0",
  "name": "Stripe",
  "description": "Read payments, manage invoices, handle subscriptions.",
  "publisher": {
    "name": "Acme Inc",
    "homepage": "https://acme.com",
    "verified": false
  },
  "entry": "dist/index.js",
  "auth": {
    "type": "oauth2",
    "provider": "stripe",
    "scopes": ["read_write"]
  },
  "events": [
    { "name": "payment_received", "schema": "./schemas/payment_received.json" },
    { "name": "subscription_canceled", "schema": "./schemas/subscription_canceled.json" }
  ],
  "actions": [
    {
      "name": "create_invoice",
      "description": "Create a new invoice for a customer.",
      "input": "./schemas/create_invoice.input.json",
      "output": "./schemas/create_invoice.output.json"
    }
  ],
  "webhooks": [
    { "event": "payment_received", "path": "/payment_intent.succeeded" }
  ],
  "minRuntime": "1.0.0",
  "license": "MIT"
}
```

The `entry` field points at the bundled module exporting the `ConnectorDefinition` (see anatomy below).

---

## 4. Anatomy of a Connector Repo

```
my-stripe-connector/
  businessos.json              ← manifest (root, required)
  README.md                    ← marketplace description
  LICENSE
  package.json
  src/
    index.ts                   ← exports ConnectorDefinition
    actions/
      create_invoice.ts
      refund_payment.ts
      list_customers.ts
    events/
      payment_received.ts      ← webhook → event mapper
      subscription_canceled.ts
    auth.ts                    ← OAuth config
  schemas/                     ← JSON Schemas referenced by manifest
    payment_received.json
    create_invoice.input.json
    create_invoice.output.json
  test/
    connector.test.ts          ← uses @businessos/connector-test-harness
  dist/                        ← built output (gitignored, generated on publish)
```

The exported `ConnectorDefinition`:

```ts
import { defineConnector } from "@businessos/connector-sdk";
import { stripeAuth } from "./auth";
import { createInvoice } from "./actions/create_invoice";
import { paymentReceived } from "./events/payment_received";

export default defineConnector({
  id: "stripe",
  auth: stripeAuth,
  events: [paymentReceived],
  actions: [createInvoice /* ... */],
  webhooks: [
    {
      event: "payment_received",
      path: "/payment_intent.succeeded",
      handler: async (req, ctx) => {
        const event = await ctx.verifyStripeSignature(req);
        await ctx.emit("payment_received", { /* mapped payload */ });
      }
    }
  ]
});
```

Three rules:

- One default export. Always a `ConnectorDefinition`.
- Pure functions for actions. No global state — context is passed in.
- Schemas are the source of truth. JSON Schemas in `schemas/` are referenced by the manifest and validated at install + runtime.

---

## 5. Building Locally

### Scaffold

```
npx create-businessos-connector my-stripe
cd my-stripe
```

This creates the repo skeleton above with placeholder action, event, and schema files.

### Local dev loop

```
pnpm install
pnpm dev          # builds, links into a local shell sandbox
```

The dev sandbox spins up a local BusinessOS shell with your connector pre-installed. OAuth flow is mocked unless you provide credentials in `.env.local`. Hot reload triggers a connector re-registration on file change.

### Testing

```
pnpm test
```

Uses `@businessos/connector-test-harness` to:

- Stub OAuth, fire fake events, assert action behavior
- Validate every emitted event against its schema
- Validate action inputs/outputs against their schemas
- Confirm the manifest itself is valid

A connector that doesn't pass `pnpm test` cannot be published to the marketplace.

---

## 6. Publishing

There are two distribution paths. Same artifact; different trust models.

### Path A — GitHub-as-registry (raw install)

1. Push the repo to GitHub (public or private).
2. Tag a release matching the manifest version: `git tag v1.0.0 && git push --tags`.
3. The release artifact must include `businessos.json`, `dist/`, and `schemas/`.

That's it. Any tenant can now install your connector by pasting the GitHub URL into the shell's "Install from URL" flow. No review, no wait, no listing.

This is the model for:

- Internal connectors a company builds for its own private SaaS
- Pre-release / beta connectors
- Power-user installs

GitHub URL installs always show the user an **"unverified publisher"** warning at install time.

### Path B — Marketplace listing (vetted)

Submit the connector to the BusinessOS marketplace:

```
npx businessos publish
```

This:

1. Builds, validates the manifest, runs tests
2. Signs the bundle with your publisher key
3. Submits to the marketplace for review

Review is automated for most checks (manifest validity, schema validity, capability declarations match actual code, no banned APIs) plus a human security review for connectors requesting sensitive scopes (e.g. financial APIs, write access to email).

Once approved:

- Your connector appears in the marketplace UI under Connectors
- Users see ratings, install count, last updated, verified publisher badge
- Updates ship through the same publish flow; users see an update prompt in the shell

The marketplace is the recommended distribution path. GitHub-direct is the escape hatch for private builds and faster iteration.

---

## 7. One-Click Install (User Perspective)

What the user sees when installing a connector:

### From the marketplace

1. Opens **Connectors** screen → **Browse**
2. Clicks Stripe → sees description, screenshots, ratings, scopes requested
3. Clicks **Install** → permission prompt:

   ```
   Stripe by Acme Inc · verified

   This connector requests permission to:
     ✦ Authenticate with your Stripe account (read + write)
     ✦ Receive Stripe webhooks at your tenant's webhook URL
     ✦ Emit 4 event types: payment_received, subscription_canceled, ...
     ✦ Expose 6 actions to agents: create_invoice, refund_payment, ...

   [Cancel]              [Install]
   ```

4. User clicks Install → OAuth flow runs → connector is live
5. Connector now appears in their Connectors list, status **Connected**

### From a GitHub URL

1. Opens **Connectors** screen → **Install from URL**
2. Pastes `github.com/acme/my-stripe-connector` (or a release URL)
3. Shell fetches `businessos.json` from the repo
4. Same permission prompt, but with **"Unverified publisher"** banner at top
5. User confirms → install proceeds the same way

The install flow is identical under the hood. Only the trust signaling differs.

---

## 8. Capabilities & Security

A connector requests a narrower set of capabilities than an app. The manifest declares them; the tenant approves on install.

| Capability                         | Meaning                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `auth:oauth:{provider}`            | Run OAuth flow with the named provider                |
| `auth:apikey`                      | Store an API key the user provides                    |
| `events:emit:{namespace}`          | Emit events under a namespace (e.g. `stripe.*`)       |
| `actions:expose:{count}`           | Number of actions exposed (declared + verified)       |
| `webhooks:receive:{path}`          | Receive webhooks at a specific path under the connector |
| `network:outbound:{domain}`        | Make outbound HTTPS calls to specific domains         |

Connectors **cannot**:

- Read or write to apps' entity tables
- Register agents (apps do that)
- Contribute UI (apps do that)
- Read the unified inbox (only emit events that *can become* inbox items via workflows)

This narrow surface is intentional. Connectors are integration plumbing, not domain logic.

### Security review (marketplace path only)

Automated checks at publish:

- Manifest declarations match actual code (no undeclared network domains, no undeclared events)
- No banned APIs (filesystem access outside sandbox, raw `eval`, dynamic imports of network resources)
- Bundle size under limit
- All schemas validate
- Test suite passes

Human review for connectors that request:

- Write access to financial APIs
- Write access to email or messaging
- Outbound network to non-major-cloud domains

GitHub-direct installs skip these checks — the user accepts the risk via the unverified-publisher warning.

---

## 9. Versioning & Updates

Connectors follow semver. The manifest's `version` is the source of truth.

| Change type                                                    | Semver bump |
| -------------------------------------------------------------- | ----------- |
| Bug fix, no API change                                         | patch       |
| New action / new event / new optional manifest field           | minor       |
| Removed action, removed event, changed action signature, capability change | major       |

Major version bumps require explicit user re-consent at update time, because the capability set may have changed. Minor and patch updates are silent (with a notification) unless the user has opted into manual approval.

Deprecated connectors are flagged in the marketplace; new installs are blocked, existing installs continue to work for a defined sunset period.

---

## 10. Examples

| Connector                                          | What to learn from it                                          |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `@boringos/connector-slack`                        | Bot-style auth, real-time event subscription, message actions  |
| `@boringos/connector-google` (Gmail + Calendar)    | OAuth with multiple scopes, polling + webhook hybrid sync, multi-service connector |
| `@boringos/connector-github` (plugin)              | Cron-based polling, webhook signature verification             |

Reference repos for each are inside `boringos-framework/packages/connector-*`. Future third-party examples will be added here.

---

## 11. Reading Order From Here

- [Building Apps](./building-apps.md) — when you want to ship a full domain plugin, not just an integration
- [Publishing & Install](./publishing-and-install.md) — deep dive on the registry, marketplace, and signed-bundle mechanics
- [Capabilities](../capabilities.md) — the full capability scope catalog

---

*Last updated: 2026-04-30*

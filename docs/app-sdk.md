# App SDK Reference

> The published, versioned contract every connector and app builds against.

This is the reference documentation for `@boringos/app-sdk` and `@boringos/connector-sdk`. It defines every type, every slot, every lifecycle hook, and every helper available to an extension.

**Audience:** Developers building extensions; reviewers verifying capability declarations.
**Read first:** [Overview](./overview.md), [Building Apps](./developer/building-apps.md), [Building Connectors](./developer/building-connectors.md).

---

## 1. SDK Versioning

The SDK follows date-based versioning, like Stripe's API:

```
@boringos/app-sdk@2026-04-30
```

Each version is supported for a minimum of 2 years after release. Breaking changes always go in a new version; old versions keep working for installed extensions until end-of-support.

Extensions declare which SDK version they target via `minRuntime` in the manifest. The shell rejects installs targeting unsupported versions.

---

## 2. The Manifest Type

The single source of truth for what an extension declares. Both connectors and apps share a base type with `kind` discriminating.

```ts
// @boringos/app-sdk

export type Manifest = ConnectorManifest | AppManifest;

interface BaseManifest {
  kind: "connector" | "app";
  id: string;                    // globally unique, kebab-case
  version: string;               // semver
  name: string;                  // display name
  description: string;
  publisher: PublisherInfo;
  minRuntime: string;            // minimum shell version
  license: string;               // SPDX identifier
}

interface PublisherInfo {
  name: string;
  homepage?: string;
  supportEmail?: string;
  verified?: boolean;            // set by marketplace, not by publisher
}

export interface ConnectorManifest extends BaseManifest {
  kind: "connector";
  entry: string;                 // path to compiled JS exporting ConnectorDefinition
  auth: AuthConfig;
  events: EventDeclaration[];
  actions: ActionDeclaration[];
  webhooks?: WebhookDeclaration[];
  capabilities: ConnectorCapability[];
}

export interface AppManifest extends BaseManifest {
  kind: "app";
  hosting: "in-process" | "remote";
  schema?: string;               // path to migrations directory
  entityTypes: EntityTypeDeclaration[];
  agents?: string;               // path to agents module
  workflows?: string;
  contextProviders?: string;
  routes?: string;
  ui: UIManifest;
  capabilities: AppCapability[];
  dependencies?: AppDependency[];
}
```

---

## 3. Connector SDK

### `defineConnector`

```ts
import { defineConnector } from "@boringos/connector-sdk";

export default defineConnector({
  id: "stripe",
  auth: stripeAuth,
  events: [paymentReceived, subscriptionCanceled],
  actions: [createInvoice, refundPayment, listCustomers],
  webhooks: [paymentWebhook]
});
```

### Auth

```ts
type AuthConfig =
  | OAuth2Config
  | ApiKeyConfig
  | CustomAuthConfig;

interface OAuth2Config {
  type: "oauth2";
  provider: string;              // "stripe", "google", "slack", or custom
  scopes: string[];
  authorizationUrl?: string;
  tokenUrl?: string;
  // Helpers handle PKCE, refresh, token storage
}

interface ApiKeyConfig {
  type: "apikey";
  fields: { name: string; label: string; secret: boolean }[];
}
```

### Events

```ts
interface EventDefinition<T = unknown> {
  name: string;                  // namespaced: "stripe.payment_received"
  schema: JSONSchema;            // validates payload at emit
  description: string;
}
```

Event handlers receive a typed context with `emit`:

```ts
const paymentReceived = defineEvent({
  name: "stripe.payment_received",
  schema: paymentSchema,
  description: "Fired when a Stripe payment intent succeeds.",
  handler: async (req, ctx) => {
    const event = await ctx.verifyStripeSignature(req);
    await ctx.emit("stripe.payment_received", { /* mapped payload */ });
  }
});
```

### Actions

```ts
interface ActionDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  handler: (input: I, ctx: ActionContext) => Promise<O>;
}
```

Actions are pure functions. The context provides:

- `ctx.auth` — resolved auth credentials for the current tenant
- `ctx.fetch` — pre-configured HTTP client (logged, rate-limited, retried)
- `ctx.tenantId` — current tenant
- `ctx.emit(event, payload)` — emit follow-up events
- `ctx.log` — structured logger

### Webhooks

```ts
interface WebhookDefinition {
  event: string;                 // event to emit when this webhook fires
  path: string;                  // mounted at /webhooks/connectors/{id}{path}
  handler: (req: Request, ctx: WebhookContext) => Promise<Response>;
}
```

---

## 4. App SDK

### `defineApp`

```ts
import { defineApp } from "@boringos/app-sdk";

export default defineApp({
  id: "crm",
  agents: [...],
  workflows: [...],
  contextProviders: [...],
  routes: registerRoutes,
  onTenantCreated,
  onUpgrade,
  onUninstall
});
```

### Lifecycle Hooks

```ts
type LifecycleHook = (ctx: LifecycleContext) => Promise<void>;

interface LifecycleContext {
  db: Database;                  // tenant-scoped DB handle (in-process apps)
  tenantId: string;
  fromVersion?: string;          // upgrade only
  toVersion?: string;            // upgrade only
  log: Logger;
}

interface AppDefinition {
  id: string;
  agents?: AgentDefinition[];
  workflows?: WorkflowTemplate[];
  contextProviders?: ContextProvider[];
  routes?: (router: Router) => void;
  onTenantCreated?: LifecycleHook;
  onUpgrade?: LifecycleHook;
  onUninstall?: LifecycleHook;
}
```

`onTenantCreated` runs at install time. Use it to seed default data, register tenant-specific agents, install workflow templates.

### Agents

```ts
interface AgentDefinition {
  id: string;
  name: string;
  persona: PersonaId;             // one of 12 built-in or "custom"
  runtime: RuntimeId;             // "claude" | "codex" | "gemini" | ...
  instructions: string;           // system prompt
  triggers: AgentTrigger[];       // event subscriptions, schedules
  budget?: BudgetConfig;
  contextProviders?: string[];    // which providers to inject (defaults to all)
}

type AgentTrigger =
  | { type: "event"; event: string; filter?: EventFilter }
  | { type: "schedule"; cron: string }
  | { type: "manual" };
```

### Context Providers

Inject app-specific information into agent prompts at run time.

```ts
interface ContextProvider {
  id: string;
  scope: "task" | "session" | "global";
  build: (ctx: ContextBuildContext) => Promise<string | StructuredContext>;
}
```

A CRM context provider might fetch the current deal's history; an Accounts context provider might fetch the customer's balance.

### Workflows

```ts
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  blocks: BlockDefinition[];
  triggers: WorkflowTrigger[];
  installAt?: "tenant_created" | "manual";
}
```

The block taxonomy, trigger types, and execution semantics live in the framework's workflow engine docs. Apps consume these primitives without redefining them.

### Routes

```ts
type RouteRegistrar = (router: Router) => void;

// Mounted under /api/{app_id}/* automatically.
const registerRoutes: RouteRegistrar = (router) => {
  router.get("/contacts", listContacts);
  router.get("/contacts/:id", getContact);
  router.post("/contacts", createContact);

  router.agentDocs = (baseUrl) => `
    GET ${baseUrl}/contacts — list contacts (query: search, limit, offset)
    GET ${baseUrl}/contacts/:id — get contact details with dossier
    POST ${baseUrl}/contacts — create a contact
    ...
  `;
};
```

The `agentDocs` field is critical — it's what makes the app discoverable to copilot and agents. The framework's `api-catalog` context provider injects every installed app's `agentDocs` into every agent's system prompt.

---

## 5. UI SDK

### `defineUI`

```ts
import { defineUI } from "@boringos/app-sdk/ui";

export default defineUI({
  pages: { ... },
  dashboardWidgets: { ... },
  entityActions: { ... },
  settingsPanels: { ... },
  copilotTools: { ... },
  commandActions: { ... },
  inboxHandlers: { ... }
});
```

### Slot APIs

#### `nav`

```ts
interface NavSlot {
  id: string;                    // matches manifest entry
  component: PageComponent;      // mounted when route is hit
}
```

#### `dashboardWidget`

```ts
interface DashboardWidget {
  id: string;
  size: "small" | "medium" | "large";
  component: WidgetComponent;
}
```

#### `entityAction`

```ts
interface EntityAction {
  id: string;
  entity: string;                // e.g. "crm_deal"
  label: string;
  icon?: string;
  visible?: (entity: Entity) => boolean;
  invoke: (entity: Entity, ctx: ActionContext) => Promise<void>;
}
```

#### `copilotTool`

```ts
interface CopilotTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  invoke: (input: any, ctx: ToolContext) => Promise<any>;
}
```

When copilot is reasoning and needs to invoke an app-defined function (e.g. "create a deal"), it calls a tool. Apps register tools via this slot.

#### `commandAction`

```ts
interface CommandAction {
  id: string;
  label: string;
  keywords: string[];            // for search
  icon?: string;
  invoke: (ctx: CommandContext) => Promise<void>;
}
```

Contributions to the global command bar (`Cmd+K`).

#### `inboxHandler`

```ts
interface InboxHandler {
  id: string;
  matches: (item: InboxItem) => boolean;
  render: InboxItemComponent;
  actions: InboxItemAction[];
}
```

**This slot is UI rendering only.** It controls how an inbox item appears in the inbox screen and what custom actions are surfaced when the user opens it. **It does not wake agents.** Agent waking on inbox events happens through *workflows* that subscribe to `inbox.item_created` (or to raw connector events for shell-mandatory workflows). Do not use `inbox.handler` for agent triggering — use a workflow with a `wake-agent` block. See [coordination.md](./coordination.md) for the full pattern.

Apps that want to interpret inbox items (an email is a CRM lead, an email is a support ticket, an email is an invoice attachment) register handlers for *rendering*. Multiple handlers can match a single item; the user picks via UI.

---

## 6. Database Access (In-Process Apps Only)

```ts
import { defineSchema } from "@boringos/app-sdk/db";

// In a migration file:
export const up = defineSchema((t) => {
  t.createTable("crm_contacts", {
    id: t.uuid().primary(),
    tenant_id: t.uuid().notNull().index(),
    first_name: t.text(),
    last_name: t.text(),
    email: t.text().index(),
    company_id: t.uuid().references("crm_companies.id"),
    custom_fields: t.jsonb(),
    created_at: t.timestamp().defaultNow(),
    updated_at: t.timestamp().defaultNow()
  });
});
```

Rules:

- All tables must include `tenant_id` and an index on it
- Table names must be prefixed with the app `id` (e.g. `crm_*`)
- No table can shadow a shell-owned table (validated at publish)
- All queries via the SDK are tenant-scoped automatically; raw queries that bypass tenancy fail review

In v1, all apps run in-process and get direct DB access through this SDK. A future remote-app runtime would route the same calls through the **Entity API** (REST + WebSocket) with identical tenant-scoped guarantees, but that runtime is deferred until a real use case requires it.

---

## 7. Event API

```ts
// Emit
await ctx.emit("crm.deal_won", { dealId, value, currency });

// Subscribe (declared in agent definition or context)
{
  type: "event",
  event: "inbox.item_created",
  filter: { source: "email" }
}
```

Events are typed per declaration. Emitting without a matching `events:emit:*` capability throws at runtime and fails review at publish.

---

## 8. Memory API

```ts
import { useMemory } from "@boringos/app-sdk/memory";

const memory = useMemory(ctx);
await memory.write("user-preference", { ... }, { scope: "tenant" });
const result = await memory.recall("contact-history-for", { contactId });
```

Memory is per-tenant, scoped, and pluggable (Hebbs by default). Apps with `memory:write` can persist; apps with `memory:read` can recall. Cross-app memory access requires the same dependency-declaration pattern as cross-app entities.

---

## 9. Test Harness

```ts
import { createTestTenant } from "@boringos/app-test-harness";

test("creates contact on email triage", async () => {
  const t = await createTestTenant({ install: ["crm"] });

  await t.simulateEvent("connector.email_received", { /* ... */ });
  await t.waitForAgent("crm-email-triage", { timeout: 5000 });

  const contacts = await t.api.get("/api/crm/contacts");
  expect(contacts.length).toBe(1);
});
```

The harness provisions an isolated tenant with an embedded postgres, mocked harness runtime, and the extension under test installed. Every assertion runs against real shell internals; no mocks of SDK surface.

---

## 10. Capability Enforcement

Every SDK call checks the calling extension's capabilities before executing. Examples:

| SDK call                              | Required capability                       |
| ------------------------------------- | ----------------------------------------- |
| `db.insert("crm_contacts", ...)`      | `entities.own:write`                      |
| `ctx.emit("crm.deal_won", ...)`       | `events:emit:crm.*`                       |
| `useConnector("google").send_email`   | `connectors:use:google`                   |
| `tasks.create(...)`                   | `entities.core:write`                     |
| `inbox.read({ ... })`                 | `inbox:read`                              |
| Slot registration                     | matching `slots:*` capability             |

Missing capability throws `CapabilityDeniedError`. Logged, surfaced to the user, blocks the install if discovered at publish review.

---

## 11. Reading Order From Here

- [Capabilities](./capabilities.md) — the full capability scope catalog
- [Building Apps](./developer/building-apps.md) — applied guide
- [Building Connectors](./developer/building-connectors.md) — applied guide

---

*Last updated: 2026-04-30*

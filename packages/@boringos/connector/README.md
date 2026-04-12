# @boringos/connector

Connector SDK for BoringOS -- interfaces, registry, OAuth, event bus, and action runner for integrating external services.

## Install

```bash
npm install @boringos/connector
```

## Usage

```typescript
import {
  createConnectorRegistry,
  createOAuthManager,
  createEventBus,
  createActionRunner,
  createConnectorTestHarness,
} from "@boringos/connector";
import type { ConnectorDefinition } from "@boringos/connector";

// Define a connector
const myConnector: ConnectorDefinition = {
  kind: "my-service",
  name: "My Service",
  oauth: { authorizeUrl: "...", tokenUrl: "...", scopes: ["read"] },
  events: [{ type: "item_created", description: "New item created" }],
  actions: [{ name: "create_item", fields: [{ name: "title", type: "string" }] }],
  createClient(credentials) { return new MyClient(credentials); },
  handleWebhook(req) { /* parse and emit events */ },
  skillMarkdown() { return "Instructions for agents..."; },
};

// Registry
const registry = createConnectorRegistry();
registry.register(myConnector);

// Event bus
const bus = createEventBus();
bus.on("my-service:item_created", (event) => {
  console.log("New item:", event.data);
});

// Action runner (agents invoke actions via callback API)
const runner = createActionRunner(registry);
await runner.run("my-service", "create_item", { title: "Hello" });

// Test harness for development
const harness = createConnectorTestHarness(myConnector);
await harness.simulateWebhook({ body: { type: "item_created" } });
```

## API Reference

### Factories

| Export | Description |
|---|---|
| `createConnectorRegistry()` | Register, lookup, and list connectors |
| `createOAuthManager(config, clientId, secret)` | OAuth authorization, code exchange, token refresh |
| `createEventBus()` | Typed event bus for connector events |
| `createActionRunner(registry)` | Execute connector actions |
| `createConnectorTestHarness(connector)` | Mock OAuth, simulate webhooks, inspect events |

### `ConnectorDefinition` Interface

| Property | Description |
|---|---|
| `kind` | Unique identifier (e.g., `"slack"`, `"google"`) |
| `name` | Human-readable name |
| `oauth` | OAuth configuration |
| `events` | Event definitions this connector can emit |
| `actions` | Action definitions agents can invoke |
| `createClient(creds)` | Factory for authenticated API client |
| `handleWebhook(req)` | Parse incoming webhooks into events |
| `skillMarkdown()` | Agent-facing instructions |

### Types

`ConnectorDefinition`, `OAuthConfig`, `OAuthTokens`, `ConnectorEvent`, `ActionDefinition`, `ActionRequest`, `ActionResult`, `ConnectorClient`, `WebhookRequest`, `WebhookResponse`, `EventBus`, `ActionRunner`, `OAuthManager`, `ConnectorRegistry`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

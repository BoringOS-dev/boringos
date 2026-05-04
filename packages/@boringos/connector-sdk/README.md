# @boringos/connector-sdk

> Focused entry point for building [BoringOS](https://boringos.dev) connectors.

This package re-exports the connector-relevant subset of [`@boringos/app-sdk`](../app-sdk). Use it when you're building an integration (Stripe, HubSpot, Zendesk, etc.) and don't want to see app/UI types.

If you're building a full domain app (CRM, Accounts, etc.), use `@boringos/app-sdk` directly.

## Quickstart

```ts
import { defineConnector } from "@boringos/connector-sdk";

export default defineConnector({
  kind: "stripe",
  name: "Stripe",
  description: "Payments and invoices.",
  oauth: {
    authorizationUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
  },
  events: [
    { type: "payment_received", description: "Stripe payment intent succeeded" },
  ],
  actions: [
    {
      name: "create_invoice",
      description: "Create a new invoice for a customer",
      inputs: { customer: { type: "string", description: "Customer id", required: true } },
    },
  ],
  createClient: (creds) => new StripeClient(creds),
});
```

Pair the runtime definition above with a `boringos.json` manifest at your repo root for marketplace install. See the [Building Connectors guide](../../../docs/developer/building-connectors.md).

## Status

`1.0.0-alpha.0` — first publishable alpha. The contract may change before `1.0.0` based on what we learn migrating the first connectors (see Phase 1 task D2). Pin to `1.0.0-alpha.0` if you need stability.

## License

MIT — see [LICENSE](./LICENSE).

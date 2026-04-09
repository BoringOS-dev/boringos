# Building Plugins for BoringOS

Plugins extend BoringOS with custom jobs, webhooks, and integrations.

## Quick Start

```typescript
import type { PluginDefinition } from "@boringos/core";

const myPlugin: PluginDefinition = {
  name: "my-plugin",
  version: "1.0.0",
  description: "Does something useful.",

  jobs: [
    {
      name: "daily-sync",
      schedule: "0 9 * * *",  // 9am daily
      async handler(ctx) {
        // ctx.db — Drizzle database
        // ctx.config — plugin config from DB
        // ctx.state — persistent key-value store
        const lastRun = await ctx.state.get("lastRun");
        // ... do work ...
        await ctx.state.set("lastRun", new Date().toISOString());
      },
    },
  ],

  webhooks: [
    {
      event: "data-received",
      async handler(req) {
        // req.body — webhook payload
        // req.config — plugin config from DB
        // req.tenantId — which tenant this is for
        return { status: 200, body: { processed: true } };
      },
    },
  ],
};

// Register with BoringOS
app.plugin(myPlugin);
```

## Plugin Definition

```typescript
interface PluginDefinition {
  name: string;           // unique identifier
  version: string;        // semver
  description?: string;   // human-readable

  configSchema?: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;

  jobs?: PluginJob[];       // scheduled/manual jobs
  webhooks?: PluginWebhook[]; // inbound webhook handlers
  setup?(ctx: AppContext): Promise<void>;  // runs on boot
}
```

## Jobs

Jobs run on a schedule or are triggered manually via the admin API.

```typescript
interface PluginJob {
  name: string;           // unique within the plugin
  schedule?: string;      // cron expression (5-field)
  handler: (ctx: PluginJobContext) => Promise<void>;
}

interface PluginJobContext {
  pluginName: string;
  tenantId: string;
  config: Record<string, unknown>;  // from DB
  db: Db;                           // Drizzle database
  state: PluginStateStore;          // persistent key-value
}
```

**Manual trigger:** `POST /api/admin/plugins/:name/jobs/:jobName/trigger`

**Job history:** `GET /api/admin/plugins/:name/jobs`

## Webhooks

Webhooks receive inbound HTTP requests from external services.

```typescript
interface PluginWebhook {
  event: string;          // e.g., "issue-created", "payment-received"
  handler: (req: PluginWebhookRequest) => Promise<PluginWebhookResponse>;
}
```

**Endpoint:** `POST /webhooks/plugins/:pluginName/:event`

Example: `POST /webhooks/plugins/github/issue-created`

## State Store

Plugins get a persistent key-value store for tracking state between runs.

```typescript
const lastSync = await ctx.state.get("lastSyncAt");   // read
await ctx.state.set("lastSyncAt", new Date());         // write
await ctx.state.delete("obsoleteKey");                  // delete
```

State is scoped per tenant + plugin. Different tenants have isolated state.

## Config

Plugin config is stored per-tenant in the database. Set via admin API or at install time.

Access in handlers: `ctx.config.token`, `ctx.config.repos`, etc.

## Built-in: GitHub Plugin

BoringOS ships with a GitHub plugin that:

- **sync-repos** job (every 15 min): syncs open issues from configured repos
- **issue-created** webhook: creates a task when a GitHub issue is opened
- **pr-opened** webhook: creates a task when a PR is opened

Config: `{ token: "ghp_...", org: "my-org", repos: ["repo1", "repo2"] }`

## Admin API

| Endpoint | Description |
|---|---|
| `GET /api/admin/plugins` | List registered plugins |
| `GET /api/admin/plugins/:name/jobs` | Job run history |
| `POST /api/admin/plugins/:name/jobs/:job/trigger` | Manually trigger a job |
| `POST /webhooks/plugins/:name/:event` | Inbound webhook |

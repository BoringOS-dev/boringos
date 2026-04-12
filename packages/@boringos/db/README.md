# @boringos/db

Database schema and connection management for BoringOS. Drizzle ORM with embedded Postgres for zero-config development.

## Install

```bash
npm install @boringos/db
```

## Usage

```typescript
import { createDatabase, createMigrationManager } from "@boringos/db";

// Embedded Postgres (zero-config, data in .data/postgres)
const { db, close } = await createDatabase({});

// External Postgres
const { db, close } = await createDatabase({
  url: "postgres://user:pass@localhost:5432/mydb",
});

// Run migrations (creates all 17 framework tables)
const migrator = createMigrationManager(db);
await migrator.bootstrap();

// Use Drizzle ORM directly
import { agents, tasks } from "@boringos/db";
const allAgents = await db.select().from(agents);

// Shut down
await close();
```

## API Reference

### Connection

| Export | Description |
|---|---|
| `createDatabase(config)` | Boot embedded Postgres or connect to external URL |
| `createMigrationManager(db)` | Schema bootstrap via DDL |

### Schema Tables

The package exports Drizzle table definitions for all 17 framework tables:

`tenants`, `agents`, `tasks`, `taskComments`, `agentRuns`, `agentWakeupRequests`, `runtimes`, `costEvents`, `approvals`, `workflows`, `connectors`, `driveFiles`, `activityLog`, `budgetPolicies`, `budgetIncidents`, `routines`, `onboardingState`

All tables include `tenantId` for multi-tenant scoping.

### Types

`DatabaseConfig`, `MigrationManager`, `Db`, `DatabaseConnection`, `FrameworkTable`

### Constants

`FRAMEWORK_TABLES` -- list of all table names

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

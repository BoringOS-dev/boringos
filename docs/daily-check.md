# Daily Check Routine

The daily check routine is a health-check mechanism that verifies the integrity of the BoringOS framework and applications built on it.

## Framework Daily Check

The framework itself runs a daily health check to ensure the codebase remains in a healthy state.

### Running the Daily Check Manually

```bash
pnpm check
```

This runs:
1. **Build** — compiles all TypeScript packages
2. **Type check** — validates type safety across the codebase
3. **Tests** — runs the test suite

### What Gets Checked

The daily check validates:

- **Build integrity**: All packages compile without errors
- **Type safety**: No TypeScript errors across the workspace
- **Functionality**: All tests pass (accounting for known flaky tests related to Postgres CONNECTION_ENDED)

### Expected Results

Based on the current baseline:
- All packages build successfully
- Type checking passes
- ~541/544 tests pass (known flaky tests due to Postgres connection issues)

## Setting Up a Daily Check Routine in Your BoringOS App

Applications built on BoringOS can set up daily health checks via **routines**.

### Declarative Setup (In a Module)

Define a routine in your module's manifest:

```typescript
{
  routines: [
    {
      id: "daily-check",
      title: "Daily Health Check",
      trigger: {
        type: "cron",
        expression: "0 2 * * *",  // 2 AM UTC daily
        timezone: "UTC"
      },
      tool: "framework.agents.wake",
      enabled: true,
    }
  ]
}
```

### Programmatic Setup

Create a routine via the admin API:

```bash
curl -X POST http://localhost:3030/api/admin/routines \
  -H "X-API-Key: $BORINGOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Daily Health Check",
    "description": "Repository health check - build, typecheck, tests",
    "assigneeAgentId": "<agent-id>",
    "cronExpression": "0 2 * * *",
    "timezone": "UTC",
    "concurrencyPolicy": "skip_if_active"
  }'
```

### Cron Expressions

Some common patterns:

- `0 2 * * *` — Every day at 2 AM UTC
- `0 9 * * MON` — Every Monday at 9 AM UTC
- `*/15 * * * *` — Every 15 minutes
- `0 */4 * * *` — Every 4 hours

See [crontab.guru](https://crontab.guru) for more examples.

### Agent Implementation

Create an agent that performs health checks:

```typescript
const healthCheckAgent = {
  name: "Health Check Bot",
  role: "engineer",
  instructions: "Run daily health checks on the repository. Build, type-check, and run tests.",
  runtimeId: runtimeId,
};

// Assign to routine
const routine = {
  assigneeAgentId: agent.id,
  cronExpression: "0 2 * * *",
  title: "Daily Health Check",
};
```

## Troubleshooting

### Tests Fail Due to Flaky Postgres

Some tests may fail intermittently with `CONNECTION_ENDED` errors due to Postgres connection issues. This is a known issue and typically resolves on the next run.

### Build Takes Too Long

The first build is slow (~3 minutes). Subsequent builds are faster. Consider adjusting the routine schedule to avoid peak hours.

### Memory Issues

If the daily check runs out of memory, consider:
- Running checks sequentially instead of in parallel
- Increasing the concurrency timeout
- Splitting checks into separate routines

## Integration with CI/CD

The daily check can complement CI/CD pipelines:

- **Local development**: `pnpm check` for quick health verification
- **Pre-commit**: Run build and typecheck on staged files
- **CI pipeline**: Run full suite on every push
- **Daily routine**: Scheduled background health checks

## Architecture

The daily check routine uses the BoringOS scheduler to:

1. Wake an agent on a cron schedule
2. Pass the agent a context with repository state
3. Let the agent run `pnpm check` (or custom commands)
4. Collect results and post a summary comment

See [CLAUDE.md](../CLAUDE.md) for architecture details on how routines are scheduled and executed.

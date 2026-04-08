# BoringOS Quickstart

Boots an BoringOS server, creates an agent, assigns a task, and watches the agent execute.

## Run

```bash
npx tsx index.ts
```

No external dependencies needed — embedded Postgres starts automatically. The agent runs via `cat` (echoes its context to stdout) so it works without any AI CLI installed.

## What happens

1. Server boots on port 3000
2. Creates "Acme Corp" tenant
3. Creates "Code Bot" engineer agent
4. Creates "Add health endpoint" task
5. Wakes the agent
6. Agent executes and prints the context it received

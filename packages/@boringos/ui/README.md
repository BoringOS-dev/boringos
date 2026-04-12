# @boringos/ui

Typed API client and headless React hooks for building dashboards on top of BoringOS. No markup, no styles -- just data and mutations.

## Install

```bash
npm install @boringos/ui
```

## Usage

### API Client (framework-agnostic, no React)

```typescript
import { createBoringOSClient } from "@boringos/ui";

const client = createBoringOSClient({
  url: "http://localhost:3000",
  apiKey: "your-admin-key",
  tenantId: "your-tenant-id",
});

const health = await client.health();
const agents = await client.getAgents();
const task = await client.createTask({ title: "Review PR", assigneeId: "agent_1" });

// Realtime events via SSE
const unsubscribe = client.subscribe((event) => {
  console.log(event.type, event.data);
});
```

### React Hooks

```tsx
import { BoringOSProvider, createBoringOSClient, useAgents, useTasks } from "@boringos/ui";

const client = createBoringOSClient({ url: "http://localhost:3000", apiKey: "..." });

function App() {
  return (
    <BoringOSProvider client={client}>
      <Dashboard />
    </BoringOSProvider>
  );
}

function Dashboard() {
  const { agents, isLoading, createAgent } = useAgents();
  const { tasks, createTask } = useTasks({ status: "open" });
  // render with your own components...
}
```

## API Reference

### Client

| Export | Description |
|---|---|
| `createBoringOSClient(config)` | Typed fetch wrapper for all REST endpoints |

### React

| Export | Description |
|---|---|
| `BoringOSProvider` | Context provider wrapping TanStack Query |
| `useClient()` | Access the client instance from context |

### Hooks

| Hook | Data | Mutations |
|---|---|---|
| `useAgents()` | Agent list | `createAgent`, `wakeAgent` |
| `useTasks(filters?)` | Task list | `createTask` |
| `useTask(taskId)` | Task + comments | `updateTask`, `postComment`, `assignTask`, `addWorkProduct` |
| `useRuns(filters?)` | Runs (polls 5s) | `cancelRun` |
| `useRuntimes()` | Runtime list | `createRuntime`, `setDefault` |
| `useApprovals(status?)` | Approval list | `approve`, `reject` |
| `useConnectors()` | Connector list | `invokeAction` |
| `useProjects()` | Project list | -- |
| `useGoals()` | Goal list | -- |
| `useOnboarding()` | Onboarding state | -- |
| `useEvals()` | Evaluation list | -- |
| `useInbox()` | Inbox items | -- |
| `useEntityRefs(type, id)` | Entity references | -- |
| `useSearch(query)` | Cross-entity search | -- |
| `useHealth()` | Server status (30s) | -- |

### Types

`BoringOSClient`, `BoringOSClientConfig`, `TaskWithComments`, `ConnectorInfo`, `HealthStatus`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

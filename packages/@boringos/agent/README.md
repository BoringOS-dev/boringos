# @boringos/agent

The execution engine -- the core of BoringOS. Orchestrates agent runs, builds context, manages wakeups, personas, budgets, workspaces, skills, and agent hierarchy.

## Install

```bash
npm install @boringos/agent
```

## Usage

```typescript
import {
  createAgentEngine,
  ContextPipeline,
  createWakeup,
  signCallbackToken,
  verifyCallbackToken,
} from "@boringos/agent";

// Create the engine
const engine = createAgentEngine({
  db,
  runtimeRegistry,
  memory,
  storage,
  queue,
});

// Hook into the lifecycle
engine.beforeRun.on((event) => console.log("Starting run:", event.runId));
engine.afterRun.on((event) => console.log("Run complete:", event.runId));

// Wake an agent
await engine.wake({ agentId: "agent_123", reason: "task_assigned" });

// Custom context provider
const myProvider: ContextProvider = {
  name: "my-context",
  phase: "context", // "system" or "context"
  priority: 25,
  async provide(event) {
    return `## My Section\nCustom context for ${event.agent.name}`;
  },
};

// Agent templates and hierarchy
import { createAgentFromTemplate, createTeam, findDelegateForTask } from "@boringos/agent";
```

## API Reference

### Engine

| Export | Description |
|---|---|
| `createAgentEngine(config)` | Main orchestrator with lifecycle hooks |
| `ContextPipeline` | Composable pipeline of context providers |
| `createWakeup(db, request)` | Wakeup coalescing (prevents duplicate runs) |
| `createRunLifecycle(db)` | Run status tracking and log appending |

### Built-in Context Providers (12)

**System phase:** `headerProvider`, `personaProvider`, `createTenantGuidelinesProvider`, `createDriveSkillProvider`, `memorySkillProvider`, `agentInstructionsProvider`, `protocolProvider`

**Context phase:** `sessionProvider`, `createTaskProvider`, `createCommentsProvider`, `memoryContextProvider`, `createApprovalProvider`, `createHierarchyProvider`

### Personas

| Export | Description |
|---|---|
| `resolvePersonaRole(role)` | Resolve role name with 30+ aliases |
| `loadPersonaBundle(role)` | Load persona markdown files |
| `mergePersonaBundle(bundles)` | Merge multiple persona bundles |

### Auth

| Export | Description |
|---|---|
| `signCallbackToken(claims, secret)` | Sign HMAC-SHA256 JWT for agent callbacks |
| `verifyCallbackToken(token, secret)` | Verify and decode callback JWT |

### Additional Systems

| Export | Description |
|---|---|
| `checkBudget(db, scope)` | Budget enforcement before runs |
| `provisionWorkspace(config, task)` | Create git worktree for execution |
| `syncSkill` / `injectSkills` | Skill sync and injection |
| `createAgentFromTemplate` | Create agents from templates |
| `createTeam` / `buildOrgTree` | Team creation and org hierarchy |
| `findDelegateForTask` / `escalateToManager` | Task delegation and escalation |

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

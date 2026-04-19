# @boringos/workflow-ui

React components and hooks for visualizing, editing, and observing BoringOS workflows. Drop-in companion to [`@boringos/workflow`](../workflow/README.md) — the engine ships the DAG runtime, this ships the canvas, palette, config forms, and run-diff view.

## Install

```bash
npm install @boringos/workflow-ui @tanstack/react-query react react-dom
```

Peer deps: `react@>=18`, `@tanstack/react-query@>=5`. The package bundles `@xyflow/react` and `@dagrejs/dagre`.

The styling assumes Tailwind CSS in the consuming app (uses utility classes like `text-text-primary`, `bg-surface-purple`, etc.). If you don't use Tailwind, wrap the components in your own theme.

## Quick start

```tsx
import {
  useWorkflows,
  useWorkflow,
  useWorkflowRun,
  WorkflowCanvas,
  BlockPalette,
  BlockConfigForm,
  RunDiffView,
} from "@boringos/workflow-ui";

// List view
function Workflows() {
  const { data } = useWorkflows();
  return <ul>{data?.workflows.map((w) => <li key={w.id}>{w.name}</li>)}</ul>;
}

// Live run detail with SSE-driven canvas
function RunDetail({ runId }: { runId: string }) {
  const { data } = useWorkflowRun(runId);  // subscribes to /workflow-runs/:id/events
  if (!data) return null;
  return <WorkflowCanvas blocks={...} edges={...} blockRuns={data.blocks} height={400} />;
}
```

## What's in the box

### Components

- **`WorkflowCanvas`** — `@xyflow/react` DAG renderer with auto-layout via dagre. Two modes:
  - `mode="view"` — read-only, used on run detail pages with live block statuses.
  - `mode="edit"` — drag/connect/delete, fires `onGraphChange(blocks, edges)`.
- **`BlockPalette`** — categorized list of all 14 block types with one-click add.
- **`BlockConfigForm`** — per-block-type config editor. Dispatches to specialized forms (TriggerForm, ConditionForm, …) and falls back to a JSON editor for unknown types.
- **`RunDiffView`** — side-by-side diff of two runs, aligned by `blockId`, highlights status / error / output differences.

### Hooks

All hooks call `/api/admin/workflow*` endpoints and read `token` + `tenantId` from `localStorage`.

| Hook | What |
|---|---|
| `useWorkflows()` | List workflows |
| `useWorkflow(id)` | Get one workflow |
| `useWorkflowRuns(workflowId)` | Recent runs for a workflow |
| `useWorkflowRun(runId)` | One run + block runs, **subscribes to SSE** |
| `useCreateWorkflow()` | Mutation: create |
| `useUpdateWorkflow()` | Mutation: patch name/blocks/edges/status |
| `useUpdateWorkflowStatus()` | Mutation: just status |
| `useExecuteWorkflow()` | Mutation: run now (background) |
| `useReplayRun()` | Mutation: replay a past run |
| `useAgentsForWorkflow()` | Lookup agents for the wake-agent dropdown |

## License

MIT

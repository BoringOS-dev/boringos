# Blocker — Sessions belong to tasks, not agents

## The invariant we want

> **A Claude session exists if and only if a task exists.** Sessions
> are stored on tasks. Agents are just identities — they don't own
> conversations.

Every wake of an agent must be bound to a task. No exceptions. The
session that resumes is the task's session. The session that gets
saved is saved to the task. Two different tasks → two different
sessions, even if they share an agent.

Workflows themselves never have sessions: they're DAG executions in
`workflow_runs`, executed by the workflow engine in Node. The Claude
piece only enters at `wake-agent` blocks, and those go through tasks.

## Problem

The framework's CLI session storage is keyed by `agent_id`, not
`task_id`. This contradicts the invariant above.

Concretely:

- `agent_runtime_state.agent_id` is `UNIQUE` — one session per agent
  total. (`packages/@boringos/db/src/schema/agents.ts`)
- Engine session lookup at
  `packages/@boringos/agent/src/engine.ts:176` filters only by
  `agentId`. `taskId` is ignored.
- Engine session save at `engine.ts:303` writes back keyed only by
  `agentId`.
- `tasks` has no `session_id` column.
- `agent_runs.session_id_before` exists in schema but is never written
  anywhere (dead column).

### Failure modes already happening

1. **Copilot cross-thread leak.** Every Copilot conversation across
   every user, every session, every workspace shares one transcript
   per tenant's copilot agent. Two users on different copilot tasks
   are talking to the same growing chat. Context providers re-state
   "you're on Task A" each turn, but the transcript itself carries
   everything from B, C, D…
2. **Stale-task replies misfire.** User comments on Task A days after
   the agent last touched B, C, D → agent "resumes" but the
   transcript ends mid-Task D. Recency bias makes the agent reply
   with Task D's state baked in, even though the comment is on A.
3. **Workflow agents drift over time.** The replier hit this at run
   #21 — the agent saw "Task complete" claims from buggy past runs
   in its own transcript and started skipping work. The current
   `stateless: true` flag (added 2026-05-07) is a band-aid that
   discards continuity entirely instead of scoping it correctly.

The framework partially papers over this via context providers
(`TaskCommentsProvider`, `TaskProvider`, `MemoryContextProvider`)
that rebuild a fresh task-scoped markdown block at every wake. This
works for short transcripts (recency bias dominates) but breaks
under volume.

## Schema

### Add `tasks.session_id`

```sql
ALTER TABLE tasks ADD COLUMN session_id TEXT;
```

That's it. Sessions ride directly on tasks. One task → one session
id. Lifetime is the task's lifetime; the FK back to tasks ensures
cascade-delete cleanup.

### Drop `agent_runtime_state` entirely

It exists today only because sessions were per-agent. Cumulative
token/cost tracking that lived on it moves to a tenant-scoped
counter or to per-run aggregation (we already have `agent_runs.usage_json`
for the latter). Decision deferred to the implementation PR but the
table itself goes.

### Keep `agent_runs.session_id_after` (audit only)

Already populated. Useful for "what session did this run touch."
`session_id_before` stays a no-op until someone writes it.

## Engine changes

### `packages/@boringos/agent/src/engine.ts`

Replace the per-agent session lookup at lines 164-178 with a
per-task one:

```ts
if (!job.taskId) {
  throw new Error(
    `Wake for agent ${job.agentId} has no taskId. ` +
    `Every wake must be bound to a task.`,
  );
}

const taskRows = await db
  .select({ sessionId: tasks.sessionId })
  .from(tasks)
  .where(eq(tasks.id, job.taskId))
  .limit(1);
const previousSessionId = taskRows[0]?.sessionId ?? undefined;
```

Replace the per-agent save at lines 282-310 with a per-task UPDATE:

```ts
if (result.sessionId) {
  await db.update(tasks)
    .set({ sessionId: result.sessionId, updatedAt: new Date() })
    .where(eq(tasks.id, job.taskId))
    .catch(() => {});
}
```

That's the entire engine change. No more branching, no more scopes.

### Drop `AgentDefinition.stateless` and `sessionScope`

Per the invariant, sessions are scoped by tasks unconditionally. The
`stateless` flag added 2026-05-07 to triage/replier becomes
unnecessary — each inbox item creates its own task, so each replier
wake is naturally on a fresh task with an empty session. Same for
triage.

Files to revert:

- `apps/generic-replier/src/agents/replier.ts` — remove `stateless`
- `apps/generic-triage/src/agents/triage.ts` — remove `stateless`
- `packages/@boringos/app-sdk/src/define-app.ts` — drop the field
- `packages/@boringos/control-plane/src/adapters/agent-registrar.ts` — remove the metadata write

## Wake paths — make them all task-bound

### `packages/@boringos/core/src/copilot-routes.ts`

Already passes `taskId` (the copilot session itself is a task with
`originKind: copilot`). No changes needed.

### `packages/@boringos/workflow/src/handlers/wake-agent.ts`

Already passes `taskId`. The block typically chains a `create-task`
block before it. No changes needed.

For workflows that have multiple `wake-agent` blocks waking the SAME
agent at different steps, each block must precede with its own
`create-task` so each wake gets a distinct task → distinct session.
Document this in the workflow authoring guide.

### Routine scheduler

Routines targeting an agent (`routines.assigneeAgentId`) currently
wake the agent without a task. Under the invariant this is illegal.
The scheduler must create a task per fire:

```ts
// packages/@boringos/core/src/routine-scheduler.ts (or wherever)
const task = await db.insert(tasks).values({
  tenantId,
  title: `Routine: ${routine.title}`,
  description: routine.description ?? "",
  origin_kind: "routine",
  origin_id: routine.id,
  assignee_agent_id: routine.assigneeAgentId,
}).returning();

await engine.wake({
  agentId: routine.assigneeAgentId,
  tenantId,
  taskId: task.id,
  reason: "routine_fired",
});
```

This is the only structural change required outside the engine.

### Admin API and any other direct `engine.wake` callers

Audit every call to `engine.wake({...})` across the repo. Any caller
that passes no `taskId` must either:

- Create a task first and pass its id, or
- Be deleted as no-longer-valid

`POST /api/admin/agents/:id/wake` (admin "wake without context"
endpoint) — must require / auto-create a task. Likely kept as a
debug path that creates a synthetic task with `origin_kind: "manual"`.

## Folded-in bugs (same root-cause family)

Both uncovered during the 2026-05-07 replier debug session.

### Duplicate agent rows for the same `appAgentDefId`

`agent-registrar.ts:117` blind-INSERTs on every install. Re-installs
that DO bump the manifest version end up with multiple rows for the
same `(tenant_id, appAgentDefId)`. Wake-agent resolver picked the
wrong (older, stale-instructions) row at random until I added
`ORDER BY created_at DESC` on 2026-05-07.

**Fix:** registrar UPSERTs on `(tenant_id, metadata->>'appAgentDefId')`
instead of INSERTing. One canonical agent row per app-def-id per
tenant. Eliminates the resolver's need to disambiguate.

### Re-install protection silently swallows updates

`tenant-provisioning.ts:84-91` short-circuits when
`tenant_apps.version === manifest.version`. Instruction edits to
`replier.ts` never reached the agents table without bumping the
manifest version, which nobody remembers to do.

**Fix:** key the short-circuit on the bundle hash (already computed
and stored as `tenant_apps.manifest_hash` in some installs) rather
than the declared version. Contents change → re-register agents.
Contents byte-identical → skip.

## Test coverage

New file: `tests/phase21-session-per-task.test.ts`

- Two tasks for one agent → two distinct sessions; comment on each
  resumes its own session, no leak
- User comments on a stale task → agent resumes that task's session,
  not the most recently used one
- Wake an agent with no taskId → engine throws
- Workflow `wake-agent` block followed by another `wake-agent` block
  for the same agent — each creates a different task and gets
  distinct sessions
- Routine targeting an agent fires → a task is created → agent
  wakes with that taskId

Update `phase18-workflow-routines.test.ts` for the routine-creates-task
behavior change.

Add a Copilot test: two simulated users open separate copilot
sessions; messages on one don't bleed into the other's transcript.

## Open questions

1. **Sub-tasks (`tasks.parent_id`) — inherit parent's session, or
   fresh?** Recommendation: fresh. A sub-task is a delegation; the
   agent should approach it cleanly, with parent context flowing
   through the description, not the transcript.
2. **Long-lived "persona" agents that want continuity across days
   — how?** Not via session. Use a long-lived task ("Daily ops
   thread for agent X"), or use memory (Hebbs) to persist
   summaries across tasks. Sessions are explicitly not the
   continuity mechanism anymore.
3. **What happens to abandoned tasks?** If a task sits in `todo`
   forever and the user later assigns it, the session resumes
   from whatever turn it was on. Likely fine — the task description
   hasn't changed. If the user wants to "reset" a task, they
   delete and recreate (or we add a `clear-session` admin action).

## Why this is a blocker

Without the invariant:

- Copilot is fundamentally broken under multi-thread use. A single
  user with three open conversations is one shared transcript.
- Long-running workflow agents drift after their N-th run.
- The "everything is a task" mental model the rest of the framework
  is designed around (origin_kind, comments, hierarchy, audit)
  doesn't extend to the agent's actual conversational state.

The current `stateless` flag patches the most acute symptom (replier
loops) but doesn't fix Copilot or any other stateful per-task agent.
This needs to land before any further investment in conversational
agents (Q-series, R-series workstreams).

## Build order

Implementation can land in this order, each piece is independently
shippable:

1. `tasks.session_id` column added (DDL only, nothing reads/writes
   it yet).
2. Engine read/write switched to `tasks.session_id`. Throw on
   missing `taskId`.
3. Audit `engine.wake` callers. Routine scheduler updated to
   create tasks. Admin "wake" endpoint updated.
4. Drop `stateless` from app-sdk + replier + triage. Drop
   `agent_runtime_state` table.
5. Registrar UPSERT + bundle-hash re-install protection (folded-in
   bugs).
6. Tests in `phase21-session-per-task.test.ts`.

Step 2 is the breaking change — once it lands, no agent can be
woken without a task. Steps 3 and 4 must follow immediately.

## Files in scope

- `packages/@boringos/db/src/schema/tasks.ts` — `session_id` column
- `packages/@boringos/db/src/schema/agents.ts` — drop `agent_runtime_state`
- `packages/@boringos/db/src/migrate.ts` — DDL emit (we're starting
  fresh, no migration logic needed)
- `packages/@boringos/agent/src/engine.ts` — session lookup + save
- `packages/@boringos/app-sdk/src/define-app.ts` — drop `stateless` / `sessionScope`
- `packages/@boringos/control-plane/src/adapters/agent-registrar.ts` — drop the flag write; UPSERT
- `packages/@boringos/core/src/tenant-provisioning.ts` — bundle-hash re-install protection
- `packages/@boringos/core/src/routine-scheduler.ts` (locate exact path) — task-per-fire
- `packages/@boringos/core/src/admin-routes.ts` — wake endpoint requires task
- `apps/generic-replier/src/agents/replier.ts` — drop `stateless`
- `apps/generic-triage/src/agents/triage.ts` — drop `stateless`
- `tests/phase21-session-per-task.test.ts` — new
- `tests/phase18-workflow-routines.test.ts` — update for routine-creates-task

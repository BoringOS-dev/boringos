# Wakeup Coalescing Implementation Summary

## Overview
Wakeup coalescing is fully implemented in BoringOS to prevent duplicate agent wake requests when multiple events target the same (agent, task) pair within a short time window.

## Implementation Details

### Core Function: `createWakeup()` 
**Location**: `packages/@boringos/agent/src/wakeup.ts`

The function implements the coalescing logic:
1. **Agent Validation** — Verifies agent exists and is invokable (not paused/archived)
2. **Coalescence Check** — Queries for existing pending wakeup with same (agentId, tenantId, taskId)
3. **Coalesce or Create**:
   - If pending wakeup exists: increment `coalescedCount`, return `{kind: "coalesced", existingWakeupRequestId: id}`
   - Otherwise: create new wakeup request with `coalescedCount: 0`, return `{kind: "created", wakeupRequestId: id}`

**Key Logic**:
```typescript
// Only coalesce when both conditions are met:
// 1. A taskId is provided
// 2. A pending wakeup exists for (agentId, tenantId, taskId) triple
if (request.taskId) {
  const existing = await db.select().from(agentWakeupRequests)
    .where(and(
      eq(agentWakeupRequests.agentId, request.agentId),
      eq(agentWakeupRequests.tenantId, request.tenantId),
      eq(agentWakeupRequests.taskId, request.taskId),
      eq(agentWakeupRequests.status, "pending"),
    )).limit(1);

  if (existing[0]) {
    // Coalesce: increment counter
    await db.update(agentWakeupRequests)
      .set({ coalescedCount: (existing[0].coalescedCount ?? 0) + 1 })
      .where(eq(agentWakeupRequests.id, existing[0].id));
    return { kind: "coalesced", existingWakeupRequestId: existing[0].id };
  }
}
```

### Integration Points

#### 1. HTTP API: POST `/api/admin/tasks/{taskId}/assign`
**Location**: `packages/@boringos/core/src/admin-routes.ts:1050`

When `wake=true` is passed:
```typescript
if (body.wake) {
  const outcome = await engine.wake({
    agentId,
    tenantId: c.get("tenantId"),
    reason: "manual_request",
    taskId,
  });
  if (outcome.kind === "created") {
    await engine.enqueue(outcome.wakeupRequestId);
  }
  return c.json({ assigned: true, wakeup: outcome });
}
```

#### 2. Engine: AgentEngine.wake()
**Location**: `packages/@boringos/agent/src/engine.ts:507`

Delegates directly to createWakeup:
```typescript
async wake(request: WakeRequest): Promise<WakeupOutcome> {
  return createWakeup(db, request);
}
```

### Database Schema
**Table**: `agent_wakeup_requests`
- `id` — UUID primary key
- `tenant_id` — UUID foreign key
- `agent_id` — UUID foreign key  
- `task_id` — UUID (optional, used for coalescing)
- `reason` — text ("manual_request", etc.)
- `status` — text ("pending", "consumed", "failed")
- `coalesced_count` — integer (default 0)
- `payload` — JSONB (optional custom data)
- `created_at`, `updated_at` — timestamps

**Unique Constraint**: Only ONE root agent per tenant (via `agents_tenant_one_root_idx` index)

## Test Coverage

### Unit Tests: `tests/wakeup-coalesce.test.ts`
Comprehensive test suite covering:
- ✓ Creates new wakeup when none exists
- ✓ Coalesces duplicate (agent, task) pairs
- ✓ Does NOT coalesce different tasks (same agent)
- ✓ Allows concurrent wakeups for same task (different agents)
- ✓ Handles agent-level wakeups (no taskId)
- ✓ Returns agent_not_found for invalid agents
- ✓ Returns agent_not_invokable for paused agents
- ✓ Returns agent_not_invokable for archived agents
- ✓ Increments coalescedCount correctly through multiple wakeups
- ✓ Coalesces only pending wakeups (not consumed/failed)
- ✓ Preserves payload parameter when creating wakeup

### Integration Tests: `tests/phase21-modal-wake.test.ts`
Tests the HTTP API end-to-end:
- ✓ Task assignment with wake=true creates wakeup request
- ✓ Task assignment without wake does not create wakeup request
- ✓ Multiple wake calls return coalesced result
- ✓ Paused agents return agent_not_invokable
- ✓ Archived agents return agent_not_invokable

## Behavior Summary

| Scenario | Result | Database |
|----------|--------|----------|
| First wake for (A, T) | `{kind: "created", id: W1}` | Creates row W1 with count=0 |
| Second wake for (A, T) | `{kind: "coalesced", id: W1}` | Updates W1, count=1 |
| Wake for (A, T2) same agent | `{kind: "created", id: W2}` | Creates separate row W2 |
| Wake for (B, T) different agent | `{kind: "created", id: W3}` | Creates separate row W3 |
| Wake paused agent | `{kind: "agent_not_invokable", status: "paused"}` | No row created |
| Wake non-existent agent | `{kind: "agent_not_found"}` | No row created |
| Consumed/failed wakeup exists | `{kind: "created", id: W_new}` | Creates new row |

## Known Constraints

1. **Task-scoped Coalescing** — Coalescing only applies when a taskId is provided. Agent-level wakes (no taskId) create separate wakeups.
2. **Pending Status Only** — Only coalesces pending wakeups. Consumed or failed wakeups are treated as ineligible.
3. **One Root Agent Per Tenant** — Database constraint enforces maximum one root agent per tenant (where `reports_to IS NULL`).

## Design Rationale

The coalescing strategy prevents queue flooding when:
- Rapid task comments arrive for the same task
- Multiple UI interactions queue overlapping wakes
- Batch imports assign tasks to the same agent

By deduplicating at the wakeup level (before job creation), we:
- Reduce queue work
- Preserve observer counts via `coalescedCount`
- Allow single run to address all coalesced requests

The (agent, task) pair is the coalescence key because:
- Each task has its own session (task-scoped sessions)
- One agent session can handle multiple comments on a task
- Different tasks need independent sessions/wakeups

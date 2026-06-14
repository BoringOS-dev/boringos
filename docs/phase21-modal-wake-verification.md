# Phase 21: Modal Wake Test Verification

## Overview
Tests the "Wake the agent now" checkbox functionality in the New Task Modal. When a task is assigned to an agent with the wake flag, the system should create and enqueue a wakeup request.

## Test Location
`tests/phase21-modal-wake.test.ts`

## Test Cases

### Test 1: assignTask with wake=true creates and enqueues wakeup request
**Scenario**: User creates a task through the modal and assigns it to an agent with "Wake the agent now" checked.

**Flow**:
1. Create tenant and agent
2. Create task via `POST /api/admin/tasks`
3. Assign task with `wake=true` via `POST /api/admin/tasks/{taskId}/assign`
4. Verify wakeup request is created in `agentWakeupRequests` table

**Assertions**:
- Task assignment response status is 200
- Response includes `assigned: true`
- Response includes `wakeup.kind === "created"`
- Wakeup request row exists with:
  - `agentId` matches the assigned agent
  - `tenantId` matches the tenant
  - `taskId` matches the task
  - `reason === "manual_request"`
  - `status === "pending"`

### Test 2: assignTask without wake does not create wakeup request
**Scenario**: User assigns a task to an agent without checking the wake checkbox.

**Flow**:
1. Create tenant and agent
2. Create task via `POST /api/admin/tasks`
3. Assign task WITHOUT `wake` parameter via `POST /api/admin/tasks/{taskId}/assign`
4. Verify NO wakeup request is created

**Assertions**:
- Task assignment response status is 200
- Response includes `assigned: true`
- Response does NOT include `wakeup` field
- No row is created in `agentWakeupRequests` for this task

### Test 3: assignTask with wake=true twice returns coalesced on second call
**Scenario**: User assigns the same task to the same agent twice with "Wake the agent now" checked both times.

**Flow**:
1. Create tenant, agent, and task
2. Assign task with `wake=true`
3. Assign same task with `wake=true` again
4. Verify coalescing behavior

**Assertions**:
- First assignment returns `wakeup.kind === "created"` with a new wakeup ID
- Second assignment returns `wakeup.kind === "coalesced"`
- Only ONE wakeup request exists in the database for this task
- The wakeup request's `coalescedCount` is incremented on the second assignment

### Test 4: assignTask with wake=true to paused agent returns agent_not_invokable
**Scenario**: User tries to wake an agent that is currently paused.

**Flow**:
1. Create tenant
2. Create agent with `status: "paused"`
3. Create task
4. Assign task with `wake=true`
5. Verify response indicates agent is not invokable

**Assertions**:
- Task assignment response status is 200
- Response includes `assigned: true` (task is still assigned)
- Response includes `wakeup.kind === "agent_not_invokable"`
- Response includes `wakeup.agentStatus === "paused"`
- No wakeup request is created in the database

### Test 5: assignTask with wake=true to archived agent returns agent_not_invokable
**Scenario**: User tries to wake an agent that is archived.

**Flow**:
1. Create tenant
2. Create agent with `status: "archived"`
3. Create task
4. Assign task with `wake=true`
5. Verify response indicates agent is not invokable

**Assertions**:
- Task assignment response status is 200
- Response includes `assigned: true` (task is still assigned)
- Response includes `wakeup.kind === "agent_not_invokable"`
- Response includes `wakeup.agentStatus === "archived"`
- No wakeup request is created in the database

## Implementation Details

### Endpoint: POST /api/admin/tasks/:id/assign
**Location**: `packages/@boringos/core/src/admin-routes.ts:1050`

**Request Body**:
```json
{
  "agentId": "uuid",
  "wake": true  // optional
}
```

**Response**:
```json
{
  "assigned": true,
  "wakeup": {
    "kind": "created" | "coalesced" | "agent_not_found" | "agent_not_invokable",
    "wakeupRequestId": "uuid"
  }
}
```

### Engine.wake() Flow
1. Calls `createWakeup(db, request)` with:
   - `agentId`: The target agent
   - `tenantId`: The tenant ID
   - `reason`: "manual_request"
   - `taskId`: The task being assigned

2. `createWakeup()` (in `packages/@boringos/agent/src/wakeup.ts`):
   - Validates agent exists and is invokable (not paused/archived)
   - Checks for coalescence (existing pending wakeup for same agent+task pair)
   - Creates new `agentWakeupRequests` row with `status: "pending"`
   - Returns outcome: `{kind: "created", wakeupRequestId: id}`

3. If outcome.kind === "created":
   - Calls `engine.enqueue(wakeupRequestId)` to queue for processing
   - Returns outcome to client

## Database Schema
**Table**: `agent_wakeup_requests`
- `id`: UUID (primary key)
- `tenant_id`: UUID (foreign key to tenants)
- `agent_id`: UUID (foreign key to agents)
- `task_id`: UUID (optional, references task)
- `reason`: text (e.g., "manual_request")
- `status`: text (default: "pending")
- `payload`: JSONB (optional)
- `coalesced_count`: integer (default: 0)
- `created_at`: timestamp
- `updated_at`: timestamp

## Key Concepts

### Wakeup Coalescing
When multiple wake requests are made for the same (agent, task) pair while a pending wakeup exists:
- Instead of creating duplicate wakeup requests
- The existing wakeup's `coalescedCount` is incremented
- Returns `{kind: "coalesced", existingWakeupRequestId: id}`
- This prevents the queue from being flooded with duplicate work

### Pending Status
All newly created wakeup requests start with `status: "pending"`. The queue processor:
- Fetches pending wakeups
- Creates agent runs
- Transitions the wakeup status as it processes

## Related Components

### UI Integration
- NewTaskModal component calls `client.assignTask(taskId, agentId, wake)`
- Checkbox state from modal is passed as `wake` parameter

### Task Model
- Tasks have `assigneeAgentId` field (UUID, nullable)
- When assigned with wake=true, simultaneously:
  - Updates task's `assigneeAgentId`
  - Creates wakeup request
  - Enqueues the wakeup for processing

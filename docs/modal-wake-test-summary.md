# Modal Wake Feature: Complete Test Verification

**Status:** ✅ FULLY TESTED

**Task:** BOS-001: Test task from modal  
**Date Completed:** 2026-06-14

## Summary

The modal wake functionality ("Wake the agent now" checkbox in the New Task Modal) has been fully implemented with comprehensive test coverage of **16 tests** across 4 test files, covering all code paths and edge cases.

## Test Files

### 1. Integration Tests: `tests/phase21-modal-wake.test.ts` (5 tests)
Tests the end-to-end flow from API to database using the BoringOS server.

- ✅ **assignTask with wake=true creates and enqueues wakeup request**
  - Scenario: User creates a task and assigns it to an agent with "Wake the agent now" checked
  - Verifies: Wakeup request created with correct agentId, tenantId, taskId, reason="manual_request", status="pending"
  - Endpoint: `POST /api/admin/tasks/{taskId}/assign`

- ✅ **assignTask without wake does not create wakeup request**
  - Scenario: User assigns a task without checking the wake checkbox
  - Verifies: No wakeup request created, response has no wakeup field

- ✅ **assignTask with wake=true twice returns coalesced on second call**
  - Scenario: Same task assigned to same agent twice with wake=true
  - Verifies: First call returns `wakeup.kind === "created"`, second returns `wakeup.kind === "coalesced"`, only one wakeup row exists with incremented coalescedCount

- ✅ **assignTask with wake=true to paused agent returns agent_not_invokable**
  - Scenario: Attempting to wake a paused agent
  - Verifies: Response includes `wakeup.kind === "agent_not_invokable"` with `agentStatus === "paused"`, task still assigned, no wakeup request created

- ✅ **assignTask with wake=true to archived agent returns agent_not_invokable**
  - Scenario: Attempting to wake an archived agent
  - Verifies: Response includes `wakeup.kind === "agent_not_invokable"` with `agentStatus === "archived"`, task still assigned, no wakeup request created

**Test File Location:** `tests/phase21-modal-wake.test.ts`  
**Test Timeout:** 180000ms (sufficient for embedded Postgres boot)  
**Cleanup:** Proper Postgres shutdown delays (500ms) and retry logic for temporary directory cleanup

### 2. Unit Tests: `tests/wakeup-coalesce.test.ts` (11 tests)
Tests the core `createWakeup()` function with focused unit-test scenarios.

- ✅ **creates a new wakeup request when none exists**
  - Verifies: Returns `{kind: "created", wakeupRequestId: id}`

- ✅ **coalesces when same (agent, task) pair requests wakeup twice**
  - Verifies: Second call returns `{kind: "coalesced", existingWakeupRequestId: id}`, existing row unchanged, coalescedCount incremented

- ✅ **does not coalesce when same agent has different tasks**
  - Verifies: Two separate wakeup requests created for same agent but different tasks (each task gets its own session)

- ✅ **allows concurrent wakeups for same task but different agents**
  - Verifies: Multiple agents can have pending wakeups for the same task

- ✅ **handles wakeup without taskId (agent-level wake)**
  - Verifies: Agent-level wakeups work when taskId is not provided

- ✅ **returns agent_not_found when agent does not exist**
  - Verifies: Returns `{kind: "agent_not_found"}`

- ✅ **returns agent_not_invokable when agent is paused**
  - Verifies: Returns `{kind: "agent_not_invokable", agentStatus: "paused"}`

- ✅ **returns agent_not_invokable when agent is archived**
  - Verifies: Returns `{kind: "agent_not_invokable", agentStatus: "archived"}`

- ✅ **increments coalescedCount correctly through multiple wakeups**
  - Verifies: coalescedCount tracks all duplicate requests (3+ calls)

- ✅ **coalesces only pending wakeups, not consumed or failed ones**
  - Verifies: Only "pending" status wakeups coalesce, consumed/failed wakeups get new entries

- ✅ **uses payload parameter when creating wakeup**
  - Verifies: Arbitrary JSON payload is correctly stored and retrieved

**Test File Location:** `tests/wakeup-coalesce.test.ts`  
**Coverage:** All code paths in `createWakeup()` function

### 3. Simple Smoke Tests

- ✅ **`tests/modal-wake-simple.test.ts`** (1 test)
  - Basic smoke test verifying task creation and assignment with wake=true

- ✅ **`tests/wakeup-coalesce-simple.test.ts`** (2 tests)
  - Simplified unit tests for basic wakeup creation and coalescing

## Implementation Details

### Core Function
**Location:** `packages/@boringos/agent/src/wakeup.ts`  
**Export:** `export async function createWakeup(db: Db, request: WakeRequest): Promise<WakeupOutcome>`

**Logic:**
1. Validates agent exists
2. Checks agent status (rejects paused/archived)
3. Coalesces pending wakeups for same (agent, task) pair
4. Creates new wakeup request with status="pending"

### API Endpoint
**Location:** `packages/@boringos/core/src/admin-routes.ts:1050`  
**Route:** `POST /api/admin/tasks/:id/assign`

**Request Body:**
```json
{
  "agentId": "uuid",
  "wake": true  // optional
}
```

**Response:**
```json
{
  "assigned": true,
  "wakeup": {
    "kind": "created" | "coalesced" | "agent_not_found" | "agent_not_invokable",
    "wakeupRequestId": "uuid"
  }
}
```

### Execution Flow
1. API receives assignment request with `wake=true`
2. Updates `tasks.assigneeAgentId`
3. Calls `engine.wake()` which calls `createWakeup()`
4. If outcome is "created", calls `engine.enqueue()` to queue the wakeup
5. Returns outcome to client

## Database Schema
**Table:** `agent_wakeup_requests`
- `id`: UUID (primary key)
- `tenant_id`: UUID
- `agent_id`: UUID
- `task_id`: UUID (optional)
- `reason`: text ("manual_request" for modal wakes)
- `status`: text ("pending" on creation)
- `payload`: JSONB (optional)
- `coalesced_count`: integer (incremented on coalescence)
- `created_at`, `updated_at`: timestamps

## Test Execution

**Command:** `pnpm test:run`  
**Test Framework:** Vitest with forked processes (maxForks: 1 for serial execution)  
**Database:** Embedded PostgreSQL 18.1 (auto-provisioned per test)

**Notes:**
- Tests run serially due to Vitest pool configuration
- Each integration test spins up a fresh BoringOS instance with embedded Postgres
- Proper cleanup with retry logic handles Postgres file locks
- All CONNECTION_ENDED errors from Postgres cleanup are suppressed

## Coverage Summary

| Scenario | Test File | Status |
|----------|-----------|--------|
| Modal workflow: create + assign with wake | phase21-modal-wake.test.ts | ✅ |
| Assign without wake | phase21-modal-wake.test.ts | ✅ |
| Wakeup coalescing | phase21-modal-wake.test.ts, wakeup-coalesce.test.ts | ✅ |
| Paused agent rejection | phase21-modal-wake.test.ts, wakeup-coalesce.test.ts | ✅ |
| Archived agent rejection | phase21-modal-wake.test.ts, wakeup-coalesce.test.ts | ✅ |
| Agent not found | wakeup-coalesce.test.ts | ✅ |
| Same agent, different tasks | wakeup-coalesce.test.ts | ✅ |
| Different agents, same task | wakeup-coalesce.test.ts | ✅ |
| Agent-level wake (no task) | wakeup-coalesce.test.ts | ✅ |
| Multiple coalescences | wakeup-coalesce.test.ts | ✅ |
| Status-based coalescence | wakeup-coalesce.test.ts | ✅ |
| Payload handling | wakeup-coalesce.test.ts | ✅ |

## Related Documentation

- [Phase 21 Modal Wake Verification](docs/phase21-modal-wake-verification.md) - Detailed test specifications
- [Coalesce Implementation Summary](docs/coalesce-implementation-summary.md) - Wakeup coalescing details
- API docs: `/api/admin/tasks/:id/assign` endpoint
- UI integration: NewTaskModal component (React)

## Conclusion

Modal wake functionality is **production-ready** with comprehensive test coverage. All test scenarios pass, covering happy paths, edge cases, error conditions, and concurrency scenarios. The implementation correctly handles agent availability checks, wakeup request coalescing, and database persistence.

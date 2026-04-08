# HEARTBEAT.md — CTO Execution Checklist

## 1. Check Context
- Read `BORINGOS_TASK_ID` and `BORINGOS_WAKE_REASON`.
- Understand what's being asked before touching code.

## 2. Update Status
- Mark task `in_progress` immediately.
- Post a comment with your technical plan.

## 3. Investigate
- Read relevant code before making changes.
- Understand existing patterns and conventions.
- Check for related tests.

## 4. Implement
- Follow existing code style and patterns.
- Write tests for new functionality.
- Keep changes focused — don't refactor unrelated code.

## 5. Verify
- Run relevant tests if possible.
- Check that the implementation matches the task requirements.

## 6. Complete
- Post a completion comment summarizing: what changed, why, and any follow-ups needed.
- Mark task `done`, or `blocked` with explanation if stuck.

# Way to Implement — Sequential vs Parallel

> When to run tasks one-at-a-time and when to spin up parallel workers.

This doc exists so the question doesn't get re-litigated every session. The default execution mode for any phase should be settled before that phase's `tasks-phase-N.json` is generated.

## The two modes

**Sequential.** One task at a time. Each completes (with verify scripts + tests + commit) before the next starts. Current default for Phase 1.

**Parallel via worker harness.** Multiple Claude workers in separate git worktrees, leasing tasks from the backlog, atomic commits merged by an integrator, glob-prefix path locks to keep work disjoint. The reference design we'd adopt is captured at:

> <https://gist.github.com/parag/c4597f68388835dbd29052a37023ddf7>

The gist describes the harness shape (worktrees, lease files, integrator role, verify-script gates, conflict detection via `allowedPaths` glob intersection). Re-read it before flipping any phase to parallel.

## The decision rule

**Parallel is strictly riskier when contracts are unstable; strictly safer when they're stable.**

Path locks catch *file* conflicts. They do not catch *conceptual* conflicts — two workers editing disjoint files but making incompatible architectural decisions. That second class is the dominant failure mode during contract-discovery work.

Use this matrix:

| Workstream type | Mode | Why |
|---|---|---|
| Discovering a contract (SDK shape, schema, capability model) | **Sequential** | Each task informs the next; mid-flight surprises are common |
| Mechanical port with a settled pattern (CRM screens → SDK slots) | **Mostly parallel** | Pattern is fixed; tasks are independent |
| New infrastructure with clear interfaces (marketplace backend, billing rails) | **Parallel** | Workstreams are genuinely independent |
| First-of-a-kind product (default apps, second app) | **Mixed** | Apps don't share files but share the SDK; SDK changes still propagate |

## Per-phase commitment

| Phase | Default mode | Notes |
|---|---|---|
| **Phase 1** (B + D + A + C + E) | Sequential | Active. SDK + install pipeline + shell are all contract-discovery. Real issues surfaced (see "Lessons from Phase 1" below). |
| **Phase 2** (CRM port — workstreams F/G/H/I/J) | Mostly parallel after the first screen ports to lock the pattern; sequential for F (chrome strip) and I (marketplace listing) |
| **Phase 3** (Accounts + canonical entities) | Sequential through entity_refs design; parallel after for Accounts subscreens |
| **Phase 4** (marketplace, dev portal, billing) | Fully parallel — workstreams P/Q/R/S/T are independent |
| **Phase 5** (commercial layer) | Fully parallel |

## Lessons from Phase 1

Cataloged so we have evidence for the "sequential during contract-discovery" rule. Each item is a real conceptual conflict that path locks would not have caught.

| Task | Issue caught | Hypothetical parallel cost |
|---|---|---|
| D2 | `$schema` IDE-hint property tripped `unevaluatedProperties: false` | All in-flight connector migrations would need rebase after the schema fix |
| D3 | Stale `tsconfig.tsbuildinfo` made dist diverge from source silently | Confidence in every cross-check would have been suspect |
| A3 | CRM's `orgName` field is wrong — framework actually expects `tenantName` | A3, A4, and CRM would all ship the wrong field name |
| A4 | A3 had dropped the user card; A4 had to restore it | Two parallel branches → no user card on either diff |
| A5 | `useInbox` returns the raw query result (vs other hooks that destructure) | All seven screens written in parallel would each independently get this wrong |

## How to flip a phase to parallel

When a phase's contract is judged stable:

1. Generate that phase's `tasks-phase-N.json` (one per phase; never pre-generate)
2. Verify every task has correct `allowedPaths` globs that don't accidentally overlap
3. Confirm verify scripts exist for every code area workers will touch
4. Set up the integrator + worker worktrees per the gist
5. Spin up workers; let the integrator merge atomic commits to main
6. Watch the first 2-3 task completions before scaling worker count

If a parallel-phase ever surfaces a conceptual conflict (architectural decision in flight), pause workers, resolve in main, then resume. Don't try to merge through it.

## What stays sequential regardless of phase

- **The first task of any new workstream.** It establishes the pattern. Once the first task lands, the rest of that workstream parallelizes.
- **Anything that bumps the SDK version.** SDK changes propagate; workers shouldn't be in flight when the contract moves.
- **Anything that changes the manifest schema.** Same reasoning.
- **The `tasks-phase-N.json` generation itself.** Has to be one document; can't be incrementally produced by parallel workers.

## What this means for the rest of Phase 1

Stay sequential through C5 (the install pipeline). After C5 lands, A8 + A9 + E1 + E2 can run in parallel — they're independent and the contracts they need are settled. E3 + E4 stay sequential because they depend on E1/E2's output. That gives ~3h wall-clock for the last batch instead of ~12h sequential.

---

*Last updated: 2026-05-05*

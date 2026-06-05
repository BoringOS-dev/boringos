# Drive / Brain — running issue log

> Append-only diary of gaps found while exhaustively testing how Drive
> actually behaves as the "company brain." Each entry is dated, has a
> repro, and includes the smallest fix that closes the gap.

Repro environment: `pnpm dev` on port 3030, tenant `397cac55-19f3-44ad-9d34-16e1b5ea19bd`, user `parag.arora@gmail.com`, CRM 0.3.0 installed.

---

## 2026-05-30 — Session 1 findings

### 1. `shared/memory/` is not seeded at tenant creation ✅ FIXED 2026-05-31

**What I expected:** every new tenant has an empty `shared/memory/MEMORY.md`
template waiting on disk, the same way each new user gets `users/<id>/memory/MEMORY.md`
and `users/<id>/preferences.md` scaffolded at signup.

**What I saw:** `.data/drive/<tenantId>/` had no `shared/` directory after
signup. The first agent that wrote to shared memory created the directory
itself. Before that, the brain has no physical scaffold at all.

**Cost:** new tenants look "blank" in the dashboard until an agent happens
to write to shared scope. Onboarding can't preview the structure.

**Resolution:** New file `packages/@boringos/core/src/drive-scaffold.ts`
exposes `scaffoldTenantSharedMemory(deps, tenantId)`. Wired into
`composedTenantHook` in `boringos.ts` so it runs on every tenant create,
plus a fire-and-forget backfill loop right after the install-manager
backfill so existing tenants get seeded on next boot. Routes through
`DriveManager.write` so the file lands in **both** the filesystem and
the `driveFiles` index in one call — also closes the **scaffold slice**
of #4 below. Verified end-to-end: fresh signup yields 3 templates on
disk + 3 entries in `/api/admin/drive/list` immediately.

Also closed in the same PR:

- The dead `scaffoldDrive()` in `@boringos/drive/src/local.ts` (imported
but never called; the empty-dirs concept was wrong — empty dirs don't
help the brain). Deleted.
- The inline `scaffoldUserMemoryFiles` in `auth-routes.ts` is gone;
`scaffoldUserMemory` from the new shared helper replaces it in all
three signup paths (new-tenant, invite-accept, legacy-join). User
templates now also land in `/drive/list` on fresh signup.

**Known limitation:** the backfill only re-seeds tenant-level
`shared/memory/MEMORY.md`; existing users' `preferences.md` files
written by the legacy bypass-path scaffold stay invisible in `/list`
until an agent edits them (at which point the `**/memory/`** reindex
catches one of them — but `preferences.md` is not under `memory/`, so
it stays invisible forever for legacy users). Per-user backfill is
deliberately deferred — different concern, broader change.

---

### 2. Specialist personas don't always update the index file (`MEMORY.md`) ✅ FIXED 2026-05-31

**What I expected:** every persona that knows the Memory SKILL updates
both the entity file (e.g. `shared/memory/domains/acme.md`) *and* the
top-level `MEMORY.md` index when material new facts land.

**What I saw:**

- Copilot updated both `acme.md` and `MEMORY.md` after CRM onboarding (added "in CRM (ids in file)").
- Follow-up-writer appended an `## Activity` section to `acme.md` but **did not touch `MEMORY.md`**.
- Company-enrichment appended `## Enrichment` to `acme.md`, also **did not touch `MEMORY.md`**.

**Cost:** the index stops reflecting what the entity files say. Future
agents reading just `MEMORY.md` to decide whether to load detail files
miss recent activity / enrichment status. The brain looks staler than it is.

**Root cause (corrected):** this was *not* a per-persona gap. The Memory
SKILL is attached **globally via the `memory` module**, so every agent
(copilot, follow-up-writer, contact-enrichment) already receives it — adding
a line to each SOUL.md would be redundant copy-paste that drifts out of sync.
The real hole was the SKILL's wording: it framed the rule around *writing /
creating* a `domains/` file ("update it every time you **write** a `domains/`
file"; "a `decisions/X.md` with **no entry**"). Both failures were **appends
to an already-indexed file** (`## Activity`, `## Enrichment`), so the agents
read "I already added a pointer for `acme.md`, the index requirement is
satisfied" — technically true under the old wording.

**Resolution:** tightened the SKILL (single source of truth), not the personas.
In `packages/@boringos/core/src/modules/memory/SKILL.md`:

- The `MEMORY.md` layout rule now reads "Update it every time you write *or
materially update* a `decisions/`/`domains/` file — including appending a
new section to an already-indexed entity file. The bullet must reflect the
file's latest state, not just its existence."
- Added an anti-pattern: "Don't treat the pointer as write-once" — appending
to an indexed file makes the existing bullet stale; refresh it.

No SOUL.md edits. Because the skill is module-scoped, every persona picks up
the corrected wording automatically.

**Known limitation (still agent-discipline, not enforced):** there's no
auto-sync that rebuilds `MEMORY.md` from the entity files — the post-run
checkpoint only reindexes the `driveFiles` DB table, never curates index
*content*. Wording lowers the miss rate but won't eliminate it under
concurrency/fanout. The robust follow-on is the synthesis pass (see #3/#7)
that rewrites the index from entity files rather than trusting every agent
to keep two files in sync by hand. Deliberately deferred — separate, broader
change.

---

### 3. No synthesis / compaction routine 

**What I expected:** something reads `tasks/*/log.md` and `*/notes/`,
promotes recurring facts into `decisions/` and `domains/`, and rolls
stale entries into `archive/`. Otherwise logs grow unboundedly.

**What I saw:** every run appends to `tasks/<id>/log.md` forever. Nothing
reads them again. They become a write-only cemetery. `task_24.md` says
this is "earned when daily logs consistently exceed a threshold" — it
isn't built. With concurrency-5 and active fanout (1 user action → 7
derived tasks in this test) the log volume ramps fast.

**Cost:** unbounded growth; brain doesn't actually learn from its own history.

**Fix:** a scheduled routine ("synthesize-memory") that runs once a day,
loads recent task logs + current MEMORY.md, and asks an agent to propose
promotions/archives. Implement as a smart routine targeting a workflow
so it only fires when the log volume warrants.

---

### 4. Dashboard drive list is incomplete — 8/10 files invisible to the user ✅ FIXED 2026-05-31 (scaffold slice earlier; checkpoint + agent-FS slices closed by the reconciler)

**Repro:**

```bash
curl -s http://localhost:3030/api/admin/drive/list \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT"
# → 2 files

find .data/drive/$TENANT -type f | wc -l
# → 10
```

**Root cause:** `admin-routes.ts:1997` queries the `driveFiles` Postgres
table only. Three writers bypass that index:

1. `scaffoldDrive` at signup — writes `users/<id>/preferences.md` and
  `users/<id>/memory/MEMORY.md` direct to FS.
2. Auto-checkpoint hook (`packages/@boringos/agent/src/memory-checkpoint.ts`)
  appends `tasks/<id>/log.md` direct to FS, doesn't insert into `driveFiles`.
3. Agent `Edit`/`Write` on the workdir symlink — partially covered by the
  checkpoint's memory-reindex (only walks `**/memory/`**), so `shared/memory/*`
   gets picked up, but any non-memory shared file (e.g. `shared/playbooks/X.md`)
   would not.

**Cost:** users open Drive in the dashboard and see "near-empty tenant"
even though the brain has grown. Looks broken; isn't.

**Asymmetry:** `GET /api/admin/drive/file/<path>` reads the filesystem
directly and returns 200 for every path I tried — so content is consistent,
only the listing is missing.

**Fix (any of):**

- Have `scaffoldDrive`, `memory-checkpoint`, and agent FS writes all go
through `DriveManager.write(...)` so the index stays authoritative.
- Add a session-end reconciler that walks the FS slice and upserts any
file not in `driveFiles`.
- Or change `/drive/list` to scan the filesystem and join with the index.

The reconciler is the smallest patch.

**Resolution:** went with the reconciler (the generic, future-proof
option — it heals drift from *any* bypassing writer without having to
chase each one). New file
`packages/@boringos/core/src/drive-reconcile.ts` exposes
`reconcileDriveIndex({ db, drive }, tenantId)`: it recursively walks the
tenant's on-disk slice (`<tenantId>/...`), and for every real file either
inserts a missing `driveFiles` row or refreshes one whose `size` no longer
matches disk (so an appended `tasks/<id>/log.md` re-syncs). The filesystem
is treated as the source of truth; the index is the self-healing cache.

Key properties:
- **Cheap steady state** — one `stat` per file; a file is only read +
  hashed when it's new or its size changed, so an unchanged tenant costs
  no content reads. Hash matches `DriveManager` (sha256, 16-char) so ETags
  stay consistent.
- **Dotfiles skipped** (`.drive-skill.md`) for parity with `DriveManager`,
  which never indexed them.
- **Best-effort + bounded** — per-file errors are swallowed, a unique-
  constraint race with a concurrent `DriveManager.write` falls back to an
  update, and a `MAX_FILES` cap stops a pathological tree from melting the
  pass. A failed reconcile never blocks the listing.

Wired into `GET /api/admin/drive/list` (admin-routes.ts) — it reconciles
*before* querying `driveFiles`, so the dashboard always reflects disk.
This closes both remaining slices: the **checkpoint** task-log appends and
the **agent-FS** non-memory writes (e.g. `shared/playbooks/X.md`) that the
`**/memory/**` reindex hook never covered. The earlier scaffold slice
(routing tenant/user scaffolding through `DriveManager.write`, see #1) is
unchanged.

Regression test in `tests/phase15-drive.test.ts` ("/drive/list reconciles
FS files that bypassed the index") writes a task log + a non-memory shared
file straight to the FS (no index row), asserts both appear in
`/drive/list` while `.drive-skill.md` does not, then appends to the log and
confirms the indexed size tracks disk and a second pass is a no-op.

**Note:** the reconcile only *adds/refreshes* — it does not prune index
rows whose backing file was deleted out-of-band (deletes still go through
`DriveManager.remove`). Orphan-pruning is deliberately deferred; it's a
different risk profile (a transient FS read error could otherwise hide a
real file) and not part of this gap.

---

### 5. No curator / write-conflict normalization ✅ CLOSED 2026-06-01

**What I expected:** with `queue.concurrency: 5` (the dev default), two
agents could write to the same shared-memory file simultaneously. Some
form of file lock, last-writer-wins-with-merge, or curator agent that
normalizes the result.

**What I saw:** the engine has nothing for this today. In this test no
two concurrent runs happened to touch the same file, but the CRM fanout
spawned 4 simultaneous runs on the same parent task, and each of those
sub-runs (enrichment, deal-analysis, etc.) is now licensed to write to
`shared/memory/domains/acme.md`. A future test with timing-sensitive
writes will tear this.

**Resolution:** the classic race (snapshot → compute → blind overwrite)
doesn't apply here. The Memory SKILL enforces Read-before-Write, so a
concurrent agent reads the *live* state of the file — including whatever
a parallel agent already wrote — and merges semantically rather than
clobbering. The `Edit` tool compounds this: it fails if the target
string changed between read and write, forcing a re-read and intelligent
retry. Agents are not dumb scripts; they reason about existing content
and append coherently.

The curator pass added to SKILL.md (2026-06-01) handles the residual
concern: index drift in `MEMORY.md` after concurrent agents each updated
entity files. Every wake spot-checks referenced files and refreshes
stale bullets before starting work.

No advisory lock needed.

---

### 6. Host CLI's skills bleed into agent context

**What I saw:** agent's transcript reports `skills: [frontend-design, neuro-copy, pmf-positioning, viral-launch, deep-research, …]` — these are skills installed on the **host user's** Claude CLI (mine), not the BoringOS-composed skills. The framework's system prompt dominates so behavior was fine, but a curious agent could call `/pmf-positioning` mid-task and waste tokens, or worse, leak workflow-shape information across tenants.

**Fix:** the runtime invokes `claude` with the user's `~/.claude/` as the
home dir. Override `CLAUDE_HOME` (or whatever the CLI uses) to point at a
per-run isolated directory so only BoringOS-composed skills/agents
appear. May not be possible without CLI cooperation; in that case,
document it and ship a smoke test that detects bleed.

---

### 7. Email path not idempotently testable without OAuth

**What I saw:** `google.gmail.send_email` returns
`{ok:false, code:"not_found", message:"Google account not connected"}`
until OAuth completes. Per-tenant connection state lives in
`/api/connectors`. There's no local mock SMTP, no "dry-run" mode that
records the would-be email to `drive/me/outbox/`, and no Resend
fallback path exposed as a tool.

**Cost:** can't write integration tests for the "agent received customer
email → updated brain → drafted reply" flow without a real Google
account in the loop.

**Fix:** ship a `dev-mail` provider that satisfies the same Tool
contract, writes outbound mail to `shared/outbox/<msgId>.eml`, and reads
inbound from `shared/inbox-dropbox/` (a directory the test harness can
populate). Enabled by `BORINGOS_MAIL=dev` env.

---

### 8. `POST /api/admin/inbox` doesn't emit `inbox.item_created` ✅ FIXED 2026-05-31

**What I expected:** the seed endpoint is comment-described as "for demo
seeds and any caller that wants to push a synthetic inbound item without
wiring a connector" (admin-routes.ts:2247). I would expect parity with the
Gmail forward-sync path — i.e. after the row is inserted, the same
`inbox.item_created` event fires on the event bus so the inbox-triage
workflow picks it up.

**What I saw:** the route just inserts and returns the row. The triage
workflow (which triggers on `inbox.item_created`, see
`packages/@boringos/core/src/modules/inbox-triage.ts:172`) never sees it.
Item sits `status=unread, linkedTaskId=null` forever; no triage, no reply
draft, no brain update.

**Cost:** the only way to integration-test the email → brain pipeline
today is to have a real Gmail account connected. Demo seeds for sales
calls / onboarding screens are dead-end items.

**Fix:** after the `db.insert` in admin-routes.ts:2255, publish the same
event the forward-sync emits (`{ type: "inbox.item_created", tenantId, itemId, source, sourceId, subject, body, from, automated: { automated: false } }`).
One additional `eventBus.emit(...)` call; the rest is already wired.

**Resolution:** `POST /inbox` now emits `inbox.item_created` right after
the insert, mirroring the forward-sync ingest shape
(`connectorKind: "framework"`, `data: { itemId, source, sourceId, subject, body, from, automated: { automated: false } }`). The `automated: { automated: false }` shape matters: the triage workflow's
`check-not-automated` condition tests `{{trigger.automated.automated}}` for
falsy, so manual seeds correctly flow through to triage instead of being
skipped as automated. Emit is fire-and-forget (wrapped in try/catch with a
`console.warn`) so a bus failure can't roll back the insert — same posture
as the existing `triage.classified` emit in the PATCH handler. Regression
test added in `tests/phase16-final-tier3.test.ts` ("POST /inbox emits
inbox.item_created…") subscribes via `context.eventBus.onAny`, POSTs a
synthetic item, and asserts the event fires with the right tenant, item id,
and `automated` shape.

**Note:** this only restores parity with the framework forward-sync path
(it wakes the **framework** `inbox-triage` workflow). The CRM's "Enrich
inbox items on ingestion" workflow also triggers on `inbox.item_created`,
so seeded items now reach CRM enrichment too. Items posted with a `status`
other than `unread` still emit (the workflow itself decides eligibility);
callers that want a truly silent insert should not use this route.

---

### 9. Agent FS sandbox covers the whole framework — tenant isolation is policy, not posix

**Severity:** high (multi-tenant breach surface)

**What I expected:** the agent process is `chroot` / `unshare(--mount)` /
namespace-jailed into its workdir so the only readable `./drive/` content
is the symlinks the framework set up — `me/`, `shared/`, `tasks/`,
`users/<me>/`. Anything outside is invisible.

**What I observed (real session, run `9939d6c1-...`, task BOS-004):** when
my `./drive/...` reads through the symlink mount started getting flaky
(probably bash subshell quirk), the agent **resolved the symlinks to their
absolute backing paths and read those directly**:

```
Read: /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/397cac55-…/shared/memory/MEMORY.md
Read: /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/397cac55-…/shared/memory/domains/acme.md
```

That's the **tenant data root**. The agent process is launched with
`--dangerously-skip-permissions` and cwd inside `.data/agent-workdirs/<task>/`.
Its parent dir is `.data/`, sibling of `.data/drive/`, and the whole
filesystem above is readable too. A curious or compromised agent can:

```
ls /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework/.data/drive/
# → every tenant's brain
cat .../.data/drive/<other-tenant-id>/shared/memory/MEMORY.md
```

**Cost:** the entire "tenant privacy is the Drive's job" claim
(`docs/blockers/task_24…md`) is *aspirational, not enforced*. ACLs on
`drive.read` / `drive.write` tools and on `GET /api/admin/drive/*` are
real. The filesystem mount is not.

**Fix options:**

1. **Posix sandbox per run** — Linux: `unshare -mU` + bind-mount the
  tenant's drive slice as the *only* visible filesystem under
   `./drive/`. macOS: `sandbox-exec` profile that restricts reads.
   Heaviest but real.
2. **chroot the workdir** to a per-run staged directory whose only
  accessible parent is `./drive/` (the symlinks). Don't put workdirs
   under `.data/`.
3. **Move tenant drive data outside the framework cwd** — e.g.
  `/var/lib/boringos/drive/<tenantId>/`, and run the dev server from
   a parent that doesn't contain it. Doesn't fix the leak but reduces
   the discovery surface.
4. **Audit / runtime guard** — wrap the runtime's CLI invocation in a
  filter that scans tool inputs for absolute paths under
   `<framework-root>/.data/drive/<OTHER-TENANT>/` and refuses them.
   Defense-in-depth but not a real boundary.

Option 1 is the only real fix. The rest are bandaids.

**Also affects the indexer:** writes done via absolute-path Edit/Write
bypass even the `**/memory/`** reindex hook in the auto-checkpoint
(see #4). So the agent that took the escape hatch also evaded the
mechanism that keeps the dashboard list honest.

---

### 10. Stale `running` run rows that never finalize ✅ FIXED 2026-06-01 (idle-watchdog slice; per-task supersede guard deferred)

**Repro:** task BOS-004 has 8 runs in `agent_runs`. Run `7c01db35` was the
first run on that task (started 19:11:25). Later runs (`52ff3d8b`)
completed normally and finalized at 19:16:05. The earlier run row stayed
`status=running, finishedAt=null` indefinitely even though:

- the auto-checkpoint hook wrote its log entry,
- the result-comment was auto-posted on the task,
- a claude subprocess is still in `ps` (PID 25901, 0.8% CPU, idle),
- the task progressed and spawned fanout downstream.

**Hypothesis:** the run stayed alive because the framework's
auto-rewake cascade re-entered the same task while the first run's
final-finalize callback was in flight, and the new run was tracked
under a new id while the original row was never explicitly closed.
Either an event was dropped or the engine never reaches the
"if I'm not the latest run on this task, mark myself done" branch.

**Cost:** dashboards show a permanently in-progress run; budget /
spent accounting may double-count; `recoverPending()` only sweeps
on boot, so until the dev server restarts the row is wrong.

**Fix:** add a per-task generation guard — when a wake creates a new
run on a task that already has a `running` row from the same agent,
either coalesce (preferred — already the doc'd behavior) or mark the
older row as superseded (`status=replaced`, `finishedAt=now()`).

**Root cause (corrected after reading the code).** A run row leaves
`running` on exactly one condition: the CLI subprocess exits and
`onComplete` fires (`engine.ts` `onComplete` → `run-lifecycle.updateStatus`).
The subprocess is awaited via `spawnAgent` (`child.on("close")`). **No
runtime ever passed a timeout**, so a CLI that hangs idle (the observed
`ps` zombie, PID 25901) never resolves → `onComplete` never runs → the row
sits `running, finishedAt=null` until the next boot's `recoverPending()`
sweep. So the orphan isn't a race on the finalize callback — it's that the
finalize callback *never gets the chance to run* when the process hangs.

We rejected "just mark the older row superseded": relabeling a row whose
process is still alive doesn't kill the process, so it leaves a **zombie**
that keeps writing comments / `shared/memory/` and burning budget while the
row lies "done." The row's terminal transition must be *caused by* actually
ending the process, not asserted independently of it. (That's exactly why
`recoverPending()` can safely bulk-fail `running` rows — at boot there is
provably no live process behind them; mid-session that invariant doesn't
hold.)

**Resolution (idle-watchdog slice).** Added a generic idle watchdog in the
one chokepoint every process runtime shares — `spawnAgent`
(`packages/@boringos/runtime/src/spawn.ts`). It resets on each chunk of
stdout/stderr; if the process is silent for the full window it's presumed
stuck, gets `SIGTERM` (then `SIGKILL` after 5s), and `spawnAgent` returns
`idleTimedOut: true`. Because it keys off *activity*, not anything
claude-specific, it covers claude / pi / gemini / ollama / chatgpt /
command alike (`webhook` has no long-lived process). Default window **7
min**, overridable via `BORINGOS_AGENT_IDLE_TIMEOUT_MS` (`0` disables); a
distinct `idleTimeoutMs` SpawnOption is also accepted for tests.

The kill then rides the **existing** failure path — no new finalize logic:

```
idle watchdog kills subprocess
  → spawnAgent resolves non-zero, idleTimedOut=true
  → runtime maps it to errorCode "stalled", calls onComplete
  → engine marks the run `failed` (errorCode="stalled")
  → afterRun handoff (boringos.ts) flips task next_actor='human'
     + stamps metadata.lastError { errorCode: "stalled", ... }
```

So a stuck task lands back in a human's lap exactly like any other failed
run, and the auto-rewake gate (`exitCode===0` only) already prevents a
money-burning retry loop. The `errorCode: "stalled"` on both the run row and
`metadata.lastError` lets the UI badge "Agent stalled" distinctly from a
crash — the "other label" without new schema.

Threaded `errorCode` through `CompletionResult` + `RuntimeExecutionResult`
(runtime types), the six process runtimes, `engine.ts` `onComplete`, and the
`afterRun` lastError stamp. Regression test
`tests/runtime-idle-watchdog.test.ts` (3 cases): a silent `sleep 30` is
killed fast with `idleTimedOut=true`/non-zero exit; a process emitting
output every 50ms inside the window is never killed; `idleTimeoutMs=0`
disables the watchdog.

**Deliberately deferred (per-task supersede guard).** The other half of the
original hypothesis — a *second* concurrent run starting on a task that
already has a live run — is a separate change. Doing it honestly requires
the engine to track in-flight child handles by runId/taskId so a new run can
**kill** the prior process before relabeling its row (relabel-without-kill
is the zombie trap above). The watchdog already closes the observed repro
(a hung process); the supersede guard is a distinct, broader change. Punted
per scope.

---

### 11. Brain-write is sometimes gated as an `agent_action` task awaiting approval ✅ FIXED 2026-06-01

**Observation, not bug — but the "obvious development per task" framing
glosses over it.** In the BOS-004 cascade, the copilot proposed a task
`f50720b1: Log Sarah Lin as renewal decision-maker + Q4 vendor-consolidation`
with `originKind: agent_action, nextActor: human`. The brain
update **didn't happen from the copilot.** It happened later — and
automatically — when the auto-fanned `contact-enrichment` agent ran
and wrote the `## New stakeholder` section to `shared/memory/domains/acme.md`.

**Why this matters:** if the user disabled CRM (or no contact was
created), the proposed brain-write would sit forever in the approval
queue and the brain would NOT grow. The reliable brain-update path
runs through CRM → enrichment fanout, not through the persona writing
shared memory directly.

**Resolution:** removed the hardcoded `APPROVALS_SKILL` from the framework
module's static skills. Replaced with a dynamic context provider in `boringos.ts`
(priority 51) that reads `connector_accounts.profile.writesGate` for the tenant
at run time. If no connector has the gate on (the default), nothing is injected —
agents act freely on everything including local drive/memory writes. If any
connectors have the gate on, only those are named in the injected skill text.

The gate is toggled per-connector via `POST /api/connectors/:kind/writes-gate`
and exposed as a "Writes gate" toggle in the connector's Manage modal
(all connected connectors now show a Manage button, not just Google). The toggle
sits next to "Email sync" for Google; other connectors show it as their only
setting.

---

### 12. Symlinked `./drive/me` reads occasionally fail through bash subshells

**Observation:** mid-run, the BOS-004 copilot suddenly couldn't read
`./drive/...` through `Bash` (`cat ./drive/me/memory/MEMORY.md`
returned errors / the `curl` chains stopped working), and the agent
fell back to absolute paths (see #9). After ~5 retries it recovered.

**Possible cause:** bash subshell + symlink resolution interacting
with macOS APFS, or environment-variable expansion failing inside a
heredoc. Worth a smoke test in CI on Linux + macOS that re-runs
50 reads through `./drive/` from inside a heredoc Bash op and
counts failures.

---

## What works well (so we don't lose this)

- `Read`-before-`Write` discipline holds across 3 different personas
(copilot, follow-up-writer, contact-enrichment).
- Auto-fanout chain — CRM create → enrichment → brain-write —
produces real cross-linked memory without explicit user prompting.
- Memory SKILL discipline travels with the module, not the persona.
- `**/memory/`** re-index hook does keep `/api/admin/drive/list`
current for memory paths (the FS-Edit writes from the
enrichment agent ARE reflected in the dashboard after the run).
- Result comment + auto-checkpoint log give the user a reliable
end-of-run trace even if intermediate steps were chaotic.

---

### 13. ~~Tenant signup doesn't seed a `runtimes` row → silent install failures~~ ✅ FIXED

**Severity:** high (silent feature loss). **Status: resolved** — see fix below.

**The real diagnosis (corrected).** This was NOT a missing-scaffold
bug. It was two leaf modules left stranded on the wrong side of the
`dc748a4` migration ("host-wide runtime via `BORINGOS_RUNTIME`; deprecate
per-tenant runtimes table"). After `dc748a4` the `runtimes` table is empty
on every fresh tenant *by design* — runtime is host-wide and the engine
resolves it from `BORINGOS_RUNTIME` at wake time, ignoring `agent.runtime_id`.

But `inbox-triage` and `inbox-replier` still ran the pre-migration guard:

```ts
const runtimes = await db.execute(sql`
  SELECT id FROM runtimes WHERE tenant_id = ${ctx.tenantId} AND type = 'claude' LIMIT 1
`);
const runtimeId = runtimes[0]?.id;
if (!runtimeId) { console.warn(...); return; }   // ← silently no-op'd on EVERY fresh tenant
```

So the triage agent + "Triage incoming inbox items" workflow (and the
replier's) were never created, even though the modules reported
`installed`. Real Gmail then sat `unread, linkedTaskId=null` forever.

**Why the originally-recommended fix here was wrong.** The earlier entry
suggested *inserting* a `runtimes` row at tenant create. That would have
revived exactly the path `dc748a4` deprecated and made the engine's
"runtime_id is ignored" contract a lie. There is no longer any such thing
as "no runtime" — there's always the host-wide one from the env var.

**The fix that shipped (full excision of the per-tenant runtime layer):**

1. Deleted the `runtimes` lookup + `if (!runtimeId) return` guard in both
  `inbox-triage.ts` and `inbox-replier.ts`; agents now insert with no
   `runtime_id` (column removed).
2. Removed the framework's coupling to the per-tenant runtime layer:
  `agents.runtime_id` / `agents.fallback_runtime_id` columns, the
   `/api/admin/runtimes` CRUD endpoints, the runtime-picker UI, the drizzle
   schema, and all engine reads. Runtime is host-wide via `BORINGOS_RUNTIME`;
   runtime *config* (e.g. `command`/`webhook`) is host-wide via
   `BORINGOS_RUNTIME_CONFIG`. The `runtimes` **table is kept as an empty,
   read-only backward-compat shim** so already-published `.hebbsmod` packages
   that still `SELECT ... FROM runtimes` in their install hooks degrade
   gracefully (empty → their "no runtime, skip" branch) instead of hard-
   erroring on a missing relation. A future major can drop the table.
3. Kept per-agent model selection: `agents.model` stays; the picker now
  sources its options from the host runtime via `GET /api/admin/runtime/models`.
4. Default Claude model is now **Haiku** (`CLAUDE_DEFAULT_MODEL`) when no
  per-agent `agents.model` / `BORINGOS_MODEL` override is set.
5. Added a regression test (`tests/inbox-default-install-fresh-tenant.test.ts`)
  that installs both default modules on a tenant with **no** runtimes row
   and asserts the agents + workflows land — the coverage gap that let this
   ship in the first place.

---

### 14. Forward-sync ingests our own SENT mail as if it were inbound — runaway fanout (label + self-sender slices ✅ FIXED 2026-05-31; alias enumeration deferred)

**Severity:** high (real money + brand risk).

**Repro:**

1. Connect Gmail; let user have a "Send Mail As" alias (`parag@revelin7.com`
  on `parag.arora@gmail.com` in this session).
2. Agent drafts a reply, user approves, `crm.email-lens` sends it via
  `gmail.send_email`.
3. Gmail stores the message with label `SENT` in the user's mailbox.
4. Forward-sync's next tick pulls it back into the BoringOS inbox
  alongside real inbound.

**What happened in this session:** the agent's outbound reply to Talker
came back in under `from: Parag Arora <parag@revelin7.com>` (the
Send-As alias), subject `Re: Please send the proposal`,
`gmailLabels: ["SENT"]`. The triage workflow promptly:

- classified it `important` ("active proposal thread"),
- created CRM company `Revelin7 (revelin7.com)`,
- created CRM contact `Parag Arora <parag@revelin7.com>`,
- spawned `Enrich contact`, `Enrich company`, and `Analyze new deal` runs
on the agent's own message,
- queued ANOTHER reply draft (a reply to itself).

**Cost:**

- token burn on enrichment for an entity that doesn't exist (Revelin7
is the user's Send-As alias, not a customer),
- CRM bloat with phantom records,
- a real possibility of an agent reply-loop if `gmailLabels: SENT`
isn't filtered out of the eligible-for-reply set,
- ANY user with a custom-domain alias on Gmail will hit this on
day one.

**Existing partial mitigation:** the forward-sync prefilter checks
`auto-submitted`, `list-id`, `precedence` — none of which are set on a
human-drafted email sent via the Gmail API.

**Fix (mandatory):**

1. In the forward-sync ingestion path, **drop messages whose
  `gmailLabels` include `SENT`** (or any other label set indicates
   the user is the sender). They belong in a separate
   `outbox-mirror` lane if we want to record them at all.
2. Also drop messages whose `From` matches any verified Send-As
  alias on the connected account (use Gmail's `/profile` + the
   `sendAs` endpoint to enumerate aliases at connect-time, cache in
   `connector_accounts.profile.sendAs`).
3. Defensive: at the inbox-replier workflow's trigger condition,
  skip any `triage.classified` event whose source item has
   `gmailLabels` including `SENT`. Defence in depth even if (1)+(2)
   leak.

**Related — surfaced in the same cascade (good, not a bug):** the
agent did spawn a `human_todo: Confirm: is parag@talker.network your own record? Tag or merge to keep` task once it noticed the duplicate
shape, so the loop-detection instinct exists — it's just too late
to prevent the wasted runs that already fired.

**Resolution (slices 1 + 2 shipped 2026-05-31):** added a self-originated
guard in `inbox-gmail-forward-sync.ts`. New exported pure predicate
`selfOriginatedReason(msg, selfAddress)` drops a fetched message when
*either*:

- it carries the `SENT` Gmail system label (covers sends from custom
Send-As aliases too, since those still land in the user's Sent
mailbox), or
- its `From` address equals the connected account address
(`connectorAccounts.accountId`, which for Google resolves to the
account email via `resolveAccountId`). This is the backstop for when
the `SENT` label is absent.

`ingestMessage` now takes `selfAddress` (threaded from `account.accountId`
already loaded in the tick loop) and returns null + logs a warn when the
guard fires. Also added `-in:sent` to the Gmail query as a cheap
pre-filter so we don't pay a `getMessage()` round-trip just to drop our
own mail; the per-message guard remains the authoritative check (defense
in depth). Covered by `tests/inbox-forward-sync-self-originated.test.ts`
(7 cases incl. the alias-From-with-SENT-label case the original report
tripped on).

**Deliberately deferred (slice 3):** verified Send-As alias enumeration
at connect-time (Gmail `/profile` + `sendAs`, cached on
`connector_accounts.profile.sendAs`). That would catch an alias `From`
*without* relying on the `SENT` label — but it's provider-specific
(Google vs Outlook differ) and the label + self-sender checks already
close the reported case. Punted per scope.

---

## 2026-06-01 — Inbox-replier agent + workflow not created for pre-existing tenants

### 15. `defaultInstall` onInstall never runs for tenants created before the module's installHandler was wired

**What I expected:** every tenant with `inbox-replier` in `module_installs` has a
Generic Email Replier agent row and a "Draft generic reply for incoming items" workflow row.

**What I saw:** the install row existed (module was registered with `defaultInstall: true`), but no agent and no workflow had been created. Reply drafts never appeared even after triage classified emails as `important`. The tenant had signed up before commits #33 (3911e55) and #37 (6dc05e3) landed, so `onTenantCreate` ran against the old version of `installHandler` which did not yet create the agent + workflow.

**Repro:** any tenant created before 2026-05-21. Check:
```sql
SELECT tenant_id FROM module_installs WHERE module_id = 'inbox-replier';
-- then confirm no matching agent row:
SELECT id FROM agents WHERE tenant_id = '<id>' AND role = 'operations';
```

**Workaround used:** called `POST /api/admin/modules/install` with `{ moduleId: "inbox-replier" }` for the affected tenant. This re-runs `installHandler` and creates the missing agent + workflow rows.

**Root cause:** `defaultInstall` fires `onTenantCreate` at signup time. If the module's `installHandler` changes after tenants already exist, those tenants are never backfilled — they silently have a stale (or no-op) install. There is no reconciliation pass on boot.

**Fix needed:** add a backfill sweep to `BoringOS.listen()` (alongside the existing `recoverPending` and shared-memory scaffold sweeps). For every tenant that has an `inbox-replier` install row but no agent row, re-run `installHandler`. Generalise as a module-level `onInstallMigrate(ctx)` hook or a version field on the install row so modules can detect stale installs and self-heal.

---

## 2026-06-01 — Inbox-replier context gaps

### 16. Replier has no tool to search prior emails from the same sender ✅ FIXED 2026-06-01

**What I expected:** when drafting a reply the agent fetches the last 3–4 emails from the same sender so it can reference prior context, answer "please check my previous email"-style requests, and personalise the draft.

**What I saw:** the replier only calls `framework.inbox.read` on the current item. No prior thread context is loaded. When Anushi's email said "please check my previous email," the agent had no way to find it.

**Root cause:** `framework` module exposes `inbox.read` and `inbox.update` but no `inbox.search`. There is no tool to query `inbox_items` by sender, date range, subject, etc. — despite the data being fully available locally in the DB (synced by the forward-sync ticker).

**Fix needed:** add `framework.inbox.search` tool — query `inbox_items` by `from`, `subject` (LIKE), date range, `status`, `triageLabel`. Returns a list of items (id, subject, from, createdAt, body snippet). Then update the replier skill (Step 3) to call `inbox.search` with `from = sender` before drafting, loading the last 3–4 matches as context.

**No external API call required** — `inbox_items` is a local Postgres table already populated by forward-sync.

---

### 17. Agents only get tools for their own module — no cross-module read access

**What I expected:** the replier (and any agent doing inbox work) can read from all locally-mirrored connector data: past emails, CRM contacts, Slack messages, etc. Write actions (send email, post tweet) are gated. Read queries are free.

**What I saw:** the replier skill only lists `framework.inbox.read/update` and `framework.tasks.patch`. It has no access to `google.*` tools, CRM read tools, or any other connector's query surface — even though all that data is already mirrored in local DB tables (`inbox_items`, `crm__contacts`, `crm__activities`, etc.).

**Root cause:** `appliesTo` scoping controls which skills are injected but agents also only see tools registered on modules that expose them. There is no "read-only access to all installed connector data" concept. The replier would have to call raw Gmail API (external round-trip) rather than the local mirror.

**Fix needed:** two-part:
1. Add read-only query tools to each module that mirrors data locally: `framework.inbox.search` (above), `crm.contacts.search`, `crm.activities.list`, `google.gmail.search` (queries local inbox_items, not Gmail API). Write tools (`google.gmail.send`, `slack.post_message`) stay behind the writes-gate.
2. Skill injection policy: agents should receive `## Available read tools` from every installed module, not just the one that owns the task. Write tools are only injected when the connector's writesGate is explicitly off (or the user approved). This is analogous to "read tweets yes, send tweet no."

---

## Next things to test (queued)

- Does the agent automatically extract facts from inbound emails and
update `shared/memory/domains/<entity>.md`?
- When the user @-mentions a known entity in a copilot message, does
the agent route to the right `domains/` file *before* answering?
- Cross-tenant isolation: confirm a second tenant cannot read
tenant A's drive even with a forged path.
- What happens if an agent writes to a path outside its ACL
(e.g. follow-up-writer writes to `users/<other-user>/memory/`)?
Hard error, silent skip, or success?
- Recall behaviour when no Hebbs API is configured — the drive-backed
provider only does grep+recency. How does it rank?
- Memory growth under concurrent writes to the same entity file
(race condition #5).


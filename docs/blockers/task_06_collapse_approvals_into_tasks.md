# Blocker — Collapse approvals into tasks; teach agents to use them

## The decision

There is **no separate `/approvals` screen**. Approvals are a special
kind of task (`origin_kind: "agent_action"`) with a decision
affordance in the detail pane. The standalone `approvals` table and
its admin endpoints get deprecated / removed.

A decision is approve **or** reject **plus an optional free-form
comment** — that comment always flows back to the agent's task
session so the agent reads the human's reasoning, not just the
yes/no bit.

This collapses the system to one queue, one schema, one mental
model. It also closes the gap that today's standalone approvals
have: agents have no way to *request* one, and decisions don't wake
anything.

## Why approvals were broken

Audit of the framework as of `1172348`:

| Piece | Status |
|---|---|
| `approvals` table | exists |
| Admin API (`GET/approve/reject`) | wired |
| `ApprovalProvider` context provider | exists |
| `WakeRequest.approvalId` field | exists |
| **Agent callback API to *request* an approval** | **MISSING** |
| **Agent persona / protocol teaches "you can request approvals"** | **MISSING** |
| **Decision actually wakes the agent** | **MISSING** — `/approve` and `/reject` update the row but never call `engine.wake({ approvalId, reason: "approval_resolved" })` |

So no live code path creates or processes approvals end-to-end. The
table is wiring without electricity.

The new model fixes all three missing pieces in one swing because
they collapse into the existing task primitive that *already has*
agent-side endpoints, persona instructions, and wake-on-comment.

## The new model

### Schema

Reuse what's already there:
- `tasks.origin_kind = "agent_action"` — tells the UI to show the
  decision card.
- `tasks.proposed_params` (jsonb) — what the agent wants to do
  (e.g. `{ kind: "send_email", to: "...", body: "..." }`).
- `tasks.metadata.approval` — stamped on decision:
  ```jsonc
  {
    "decision": "approve" | "reject",
    "decidedAt": "2026-05-08T12:00:00Z",
    "decidedByUserId": "...",
    "comment": "yes, but use the contractor template not the
               employee one"
  }
  ```
- `tasks.status` — `done` after approve (and the action runs),
  `cancelled` after reject. Same lifecycle as any task.

No new columns. No new tables.

The existing `approvals` table + admin routes + `ApprovalProvider` +
`WakeRequest.approvalId` are all deprecated. Either delete on the
next breaking-change cycle or leave as a no-op shim. Lean toward
**delete** — they were never used end-to-end so there's no data to
preserve.

### Agent flow (the missing half)

1. Agent on task T realizes it needs human permission to do X.
2. Agent creates a child task via the existing
   `POST /api/agent/tasks` endpoint:
   ```json
   {
     "parentId": "T",
     "title": "Approve sending the Acme proposal",
     "description": "## What I want to do\n\nSend the email below to
                    Mira at acme.com…\n\n```\n<draft body>\n```\n\n
                    ## Why I'm asking\n\nThe deal value is over the
                    $10K threshold the team set last month.",
     "originKind": "agent_action",
     "proposedParams": {
       "kind": "send_email",
       "to": "mira@acme.com",
       "subject": "Acme proposal",
       "body": "<draft>"
     },
     "assigneeUserId": "<owner of parent task>",
     "priority": "high"
   }
   ```
3. Agent ends its current run on T (status remains
   `in_progress` or `blocked` while it waits).
4. User sees the new agent-action task in **My todos** with a
   green Approve / red Reject pair at the top of the detail.
5. User clicks one, optionally types a comment, submits.
6. Server posts the comment, stamps `metadata.approval`, updates
   status, **and wakes the original agent on T** so it can pick up
   the decision in its session transcript.

### Server endpoints

One new admin endpoint replaces the two old approval ones:

```
POST /api/admin/tasks/:id/decision
  body: { kind: "approve" | "reject", comment?: string }
```

Behavior:
- Validates `task.origin_kind === "agent_action"`.
- Posts the optional comment as a `task_comments` row authored by
  the user.
- Stamps `metadata.approval = { decision, decidedAt, decidedByUserId,
  comment }`.
- Updates `status`: `done` on approve, `cancelled` on reject.
- Wakes the *parent task's* assignee on the parent task (so the
  requesting agent reads the thread).
- Optionally — if approve and `proposedParams.kind` is one of the
  framework's known invokable actions (`send_email`, etc.) — runs
  the action server-side. v1: defer this; the agent on the parent
  task can re-trigger the action itself once it sees the approval.
- Emits `task:decision_made` realtime event.
- Activity log: `task.approved` / `task.rejected`.

Comments still flow through the existing `POST /tasks/:id/comments`
endpoint without any decision attached — useful for clarification
back-and-forth before a decision lands.

### Agent SDK: teach the agents

This is the piece you flagged. Two parts:

#### 1. New skill markdown

`packages/@boringos/agent/src/skills/approvals.md` (or a section in
the existing protocol provider):

```md
## Asking for human approval

When you need a human to OK something irreversible, expensive, or
sensitive — sending an email outside the team, spending budget,
deleting data, taking an action that crosses a policy line — DO
NOT just do it.

Create a child task instead:

  curl -X POST $BORINGOS_CALLBACK_URL/api/agent/tasks \
    -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "parentId": "<your current task id>",
      "title": "<one-line summary of what you want approval for>",
      "description": "<markdown explaining what you want to do, why,
                      and the alternatives you considered>",
      "originKind": "agent_action",
      "proposedParams": { "kind": "<action name>", ...inputs },
      "assigneeUserId": "<owner of your current task>",
      "priority": "high"
    }'

Then mark your current task `blocked` (or end your run cleanly).
The user will Approve or Reject, optionally with a comment. When
they do, you'll wake on your CURRENT task with the new comment in
the thread — that comment is the human's full reasoning, not just
yes/no. Read it carefully and act accordingly.

If you're rejected, propose an alternative or close out gracefully.
Never re-submit the same request without addressing the rejection
reason.
```

#### 2. Protocol provider mentions approvals

The execution-protocol context provider already lists callback API
endpoints. Add a sentence pointing at the skill so agents that
don't read every skill still get a nudge: "Need permission for
something irreversible? See the `approvals` skill."

### UI: the decision card

In `TaskDetail.tsx`, when `task.origin_kind === "agent_action"`:

- **Before decision (status === "todo" / "in_progress")**: a
  prominent card above the description with:
  - The proposed-params summary in a friendly format ("send_email
    to mira@acme.com" / "spend $50 on Anthropic credits")
  - Big Approve (green) / Reject (red) buttons
  - A comment textarea (optional)
  - Clicking either runs the new `/decision` endpoint
- **After decision (status === "done" or "cancelled" with
  metadata.approval)**: the card collapses to a small
  green or red bar: "✓ Approved by Parag · 2h ago" + the comment if
  any. Stays visible so the audit trail is obvious.

The `<Markdown>` component already handles rich-format requests in
the description. Slash commands (`/done`, `/reject`) on the regular
reply box ALSO work — they're just shortcuts for the same endpoint.

### Wake-on-decision plumbing

The decision endpoint must wake the requesting agent so it sees the
comment. Two approaches:

**A. Wake on the child task** (the agent_action task itself).
- Simple: existing `comment-posted` auto-wake fires.
- The agent assigned to the child task wakes, reads the decision,
  posts a follow-up comment on the parent ("approval received,
  proceeding") and wakes the parent agent.
- Two hops, but no new framework code.

**B. Wake on the parent task** (the original work).
- The decision endpoint walks `parent_id` and wakes the parent
  agent directly with the comment context.
- One hop, but requires the decision endpoint to know the parent
  is what's interesting.

Recommendation: **B**. Saves the round trip and avoids needing an
agent on the child task at all (the child task is just a permission
slip; nobody owns it but the framework). Implementation: when
`/decision` lands, load the task, load `parent_id`, fetch
`parent.assignee_agent_id`, call `engine.wake({ agentId, taskId:
parent_id, reason: "comment_posted" })` after copying the decision
comment over to the parent task's `task_comments`.

The child task's own row stays as the audit record.

## Why a comment matters

Per your feedback: a yes/no isn't enough.

> *"Approve, but use the contractor template not the employee one."*
> *"Reject — Mira's company is a competitor; do not engage."*
> *"Approve — but cap the spend at $30, not $50."*

Each of these is a different agent action even though the headline
decision was "approve." Without the comment, the agent doesn't know
why or under what conditions, and it'll either ignore subtleties or
get the user to approve again. The comment routes through the
existing task conversation thread, which the agent's per-task
session resumes from. So the next CLI turn sees:

```
[full prior transcript on the parent task]
  +
[fresh context: ## Recent Comments
                User: Approve, but use the contractor template
                       not the employee one]
```

— and continues with that constraint baked in.

## Open questions

- **What if `proposed_params.kind` is recognized as a connector
  action** (`google.send_email`, etc.)? Should the server *execute*
  the action on approve, or leave it to the agent to do? Lean
  toward server-side execution for the common cases — it removes a
  hop and avoids the agent regenerating the email body. Specifically
  invokable kinds get a server-side runner; everything else (edit
  files, write code, custom workflows) stays agent-driven.
- **What about approvals from non-task triggers** — e.g., a routine
  needs a yearly budget OK before running? The routine's wake-agent
  block creates a parent task per fire (already required by the
  per-task-session invariant), so it has somewhere to be the parent
  for the agent_action child. No new mechanism needed.
- **Agent self-creates approval but doesn't end its run.** Then the
  parent task is still "running" while waiting on the approval —
  fine, the agent's next turn just sits in the queue until the
  decision wakes it.
- **Multiple pending approvals on one parent.** Allowed. Each
  agent_action is its own child task. The parent agent sees N comments
  trickle in as they're decided.
- **Deprecate the `approvals` table now or later?** Now —
  it has no live consumers. Drop it in the same PR.

## Why this matters

Today the system has:
- A useful Tasks UI (just shipped) that supports rich conversation
- A dormant Approvals primitive that's never been used end-to-end

Layering a *second* UI for what is structurally a task-with-a-button
fragments the UX, fragments the schema, and forces agents to learn
two callback APIs for one concept. Collapsing them fixes all of
that and gives agents a clearly-documented permission system in one
place.

## Files in scope

- **Server**
  - `packages/@boringos/core/src/admin-routes.ts` —
    `POST /tasks/:id/decision`; remove `/approvals/*` routes
  - `packages/@boringos/agent/src/providers/approval.ts` — delete or
    rewrite to read `task.metadata.approval` instead of the
    `approvals` table
  - `packages/@boringos/agent/src/types.ts` — drop
    `WakeRequest.approvalId`
  - `packages/@boringos/db/src/schema/approvals.ts` — delete
  - `packages/@boringos/db/src/migrate.ts` — drop the
    `CREATE TABLE approvals` block
- **Agent SDK / persona**
  - `packages/@boringos/agent/src/providers/protocol.ts` — append
    "approvals" section
  - `packages/@boringos/agent/src/skills/approvals.md` — new
- **Shell**
  - `packages/@boringos/shell/src/screens/Tasks/TaskDetail.tsx` —
    decision card when `origin_kind === "agent_action"`
  - `packages/@boringos/shell/src/screens/Tasks/DecisionCard.tsx` —
    new
  - `packages/@boringos/shell/src/screens/Tasks/presenter.ts` —
    proposed-params formatter for the friendly summary
  - `packages/@boringos/shell/src/App.tsx` — drop `/approvals` route
  - `packages/@boringos/shell/src/chrome/Sidebar.tsx` — remove
    "Approvals" sidebar entry
- **UI client**
  - `packages/@boringos/ui/src/client.ts` — new `decideTask(id, kind,
    comment?)` method; remove approval-related methods
- **Tests**
  - `tests/phase22-approvals-as-tasks.test.ts` — new: agent creates
    agent_action task, user decides, parent agent wakes with comment

## Build order

1. Agent skill markdown + protocol provider blurb (zero risk;
   teaches without changing wire format).
2. `POST /tasks/:id/decision` endpoint with parent-wake plumbing.
3. UI `DecisionCard` in task detail.
4. Wire `client.decideTask`.
5. Tests.
6. Deprecation pass — remove `approvals` table, routes, provider,
   `WakeRequest.approvalId`, sidebar entry.
7. (Optional v2) Server-side runner for known invokable
   `proposed_params.kind`.

Steps 1–5 ship a working approve-with-comment UX. Step 6 is the
cleanup. Step 7 is a quality-of-life win that can wait.

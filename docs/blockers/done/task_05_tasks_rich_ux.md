# Brainstorm — Tasks UX, made rich

## Where we are today

`Tasks.tsx` is 94 lines: a flat list of rows with title, description,
priority chip, status. Nothing is clickable; no detail; no actions.

By contrast, the inbox has a two-pane layout with threading, AI
drafts, send-via-Gmail composer, snooze with live countdown,
schedule-from-inbox, bulk select, classification chips, search,
filter-by-classification.

Tasks deserves the same depth. This doc is the brainstorm before
implementation — *don't ship from here without picking what's in
scope first.*

## What is a task in Hebbs, really?

Tasks come from many origins (`origin_kind`):

| Origin                 | Created by                      | Typical lifetime  |
| ---------------------- | ------------------------------- | ----------------- |
| `manual`               | User clicks "+ New" or assigns  | Hours → weeks     |
| `copilot`              | User starts a Copilot session   | Open while chatting |
| `inbox.item_created`   | Triage workflow per email       | Seconds (one run) |
| `inbox.draft_reply`    | Replier workflow per email      | Seconds (one run) |
| `routine`              | Scheduler per cron fire         | Seconds–minutes   |
| `handoff`              | Agent delegates to another      | Hours             |
| `human_todo`           | Agent asks the user a question  | Hours → days      |
| `agent_action`         | Agent proposes an action awaiting human approval | Minutes → hours |

These are not the same kind of thing. A `routine` task is a system
heartbeat the user shouldn't see; a `human_todo` task is the agent
asking a question the user MUST see. Treating them in one
undifferentiated list is the core problem.

## The two failure modes today

1. **System-task pollution.** 50 inbox emails → 100 tasks
   (50 triage + 50 draft) in the user-facing Tasks view, drowning
   out the 2 actual `human_todo` rows. Every test session bloats
   this further.
2. **Tasks that mean something to the user are unclickable.** A
   `human_todo` row reads "Need to review proposal — 3 questions"
   but the user can't click in to see the questions, comment back,
   or mark done. Detail lives only in `task_comments`, never
   surfaced.

Fixing these is the work.

## Proposed model

### A. Filter by intent, not status

Replace today's tab strip (`todo` / `in_progress` / `blocked` /
`done` / `all`) with intent-based tabs that match what the user
actually wants:

| Tab            | What's in it                                     |
| -------------- | ------------------------------------------------ |
| **My todos**   | `human_todo`, `agent_action`, manual tasks assigned to the user; not done |
| **Watching**   | Tasks the user created or is the boss-of, but assigned to an agent; in flight |
| **Done**       | Anything completed in the last 30 days, mine or watched |
| **System**     | Inbox-spawned, routine-spawned, copilot-spawned (collapsed by default) |
| **All**        | The current "all" — kept as escape hatch        |

Default tab: **My todos**.

The `system` bucket is the cluttered one we're hiding by default.
Implementation note: filter on `origin_kind LIKE 'inbox.%' OR
origin_kind = 'routine' OR origin_kind = 'copilot'`. Surface a
small count in the tab badge so users can tell something's there.

### B. Two-pane layout (mirror the inbox)

Click any task row → detail pane on the right. Detail shows:

- **Header:** title (editable inline), status pill, priority,
  identifier (BOS-001), origin badge ("from email", "from copilot",
  "from routine") with deep-link to source.
- **Description** rendered as Markdown.
- **Conversation thread** — `task_comments` chronologically.
  Authors clearly distinguished: user avatar/name vs agent
  avatar/name + role. Same affordance as the Copilot screen.
- **Inline reply box** — types a comment; if there's an assigned
  agent, posting auto-wakes them (the framework already does this).
  This is where most of the "rich" feel comes from.
- **Subtasks** — children via `tasks.parent_id`, collapsed by
  default with progress count.
- **Activity log** — runs, status changes, assignment changes,
  read by whom. Quiet by default; expandable.
- **Right rail:** assignee picker (agents + users), priority,
  labels, due date, project, related entities (linked email /
  meeting / contact via `entity_references`).

### C. Task actions

Toolbar in the detail header:

- Mark done / Reopen
- Reassign (search-pickable)
- Wake assignee (manual kick when an agent looks stuck)
- Set priority
- Add label
- Delete (with confirm; soft-delete by status='cancelled')
- Convert to subtask of another (drag in the list, or "move under…")
- Snooze (same affordance as inbox — reappears at a future time)

Keyboard parity with inbox: `j/k` next/prev, `Enter` open, `e`
done, `s` snooze, `r` reply.

### D. Special-case the noisy origin kinds

`inbox.item_created` and `inbox.draft_reply` tasks shouldn't
generally be shown to the user at all under "My todos." But they
shouldn't disappear either — sometimes the agent fails and a
human needs to investigate. Two refinements:

1. **Auto-collapse done system tasks after 24 hours.** Status flips
   to `archived` (new column on `tasks`) and they disappear from
   the System tab as well unless the user toggles "show archived."
2. **Surface failures.** A system task whose latest agent run
   ended `failed` or whose `error_code IS NOT NULL` jumps into
   "My todos" with a "needs attention" badge. The point is: *if
   it's working, hide it; if it's broken, surface it.*

### E. Inline reply / mention syntax

In the comment composer:

- `@username` — mentions a teammate (notify via SSE / email)
- `@agent_name` — mentions an agent (auto-assigns if not assigned)
- `/done` — typed in the comment, mark task done as you reply
- `/assign @x` — reassign as you reply

Cheap to implement, makes the task page feel like Linear/Slack
instead of a CRUD list.

### F. Empty-state framing

Today: "No tasks yet — Tasks are created by you, by agents, or by
workflows." That's a teaching moment but not actionable.

Better:
- **My todos empty:** "Inbox zero on tasks too. Nothing waiting on
  you right now." — celebratory tone.
- **Watching empty:** "Nothing in flight. When you ask an agent to
  do something, it'll show up here while it's working."
- **System empty:** "No automated tasks. Connect a connector under
  Connectors to start ingesting work."

## What to actually build (proposed slice for v1)

A v1 PR could be:

1. **Origin-aware tab filter.** New tabs (My todos default,
   Watching, Done, System, All). Database query by origin_kind +
   assignment + status — all already in the schema.
2. **Two-pane layout.** Click a row → detail.
3. **Detail pane v1:** header, description, conversation thread
   (existing comments), inline reply that auto-wakes assignee.
4. **Three header actions:** Mark done, Reassign, Set priority.
5. **Failure surfacing:** system-origin tasks with a failed run
   bubble into "My todos" with the badge.

Defer to v2:
- Subtask tree
- Snooze on tasks (likely yes, but mirrors inbox snooze ticker)
- Mention syntax / slash commands
- Right-rail (entity refs, labels, due dates)
- Keyboard shortcuts
- Bulk actions

Defer indefinitely until needed:
- Drag-and-drop reordering
- Custom views / saved filters
- Time tracking

## Schema changes

Almost none for the v1 slice — `tasks`, `task_comments`,
`agent_runs` all already carry the data we need.

Only addition: `tasks.archived_at TIMESTAMPTZ` so done system
tasks can disappear from default views without losing data. This
mirrors the inbox archive pattern we already shipped.

For v2, if we want snooze on tasks: `tasks.snooze_until` +
`status='snoozed'`, mirroring `inbox_items` directly.

## Open questions

- **Should done system tasks be deleted instead of archived?** They
  have no audit value individually; the agent_runs row carries the
  history. Counter-argument: keeping them lets us answer "did the
  triage workflow process this email?" by joining inbox_items →
  tasks. Lean toward archive, not delete.
- **What about unassigned tasks?** Today `assignee_agent_id IS NULL`
  is common (workflow creates task → wake-agent block resolves the
  assignee at run time). The "Watching" tab needs a heuristic for
  these — probably "created by me, no assignee = mine to assign."
- **Tasks vs Approvals.** There's a separate `approvals` table for
  "agent wants permission, user must say yes/no." Should approvals
  appear in the Tasks list or stay separate? Lean toward separate —
  they're a yes/no decision, not a thread.
- **Copilot tasks specifically.** Each Copilot session is a task,
  but the user already views these on the Copilot screen. Should
  they show up in Tasks at all? Lean toward "no" — exclude
  `origin_kind = 'copilot'` from every Tasks tab; they live on
  Copilot.
- **Multiple assignees.** Today a task has one `assignee_agent_id`
  OR one `assignee_user_id`. Does Hebbs need multi-assign? Probably
  no for v1 — most tasks are owned by one entity. If two agents
  collaborate, they hand off via subtasks.

## Why this matters

The Tasks screen is the system's single throat for "what does this
person/team need to do, and what's the state of work in flight?"
It's where Hebbs proves it's not just an email client — it's an
operations layer. If Tasks reads as "a debug list of every system
event" (today) instead of "a thoughtful workspace for action items"
(target), the rest of the product loses coherence.

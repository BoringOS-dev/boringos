# Blocker — Calendar surface + schedule-from-inbox

## Why now

The replier agent's draft on Mira's lead email literally said:
*"Let me check my calendar for a 30-minute slot in the next week or
two and get back to you with some times that work for CT
afternoons."*

That capability doesn't exist in the product. The Google connector
has the underlying actions (`list_events`, `create_event`,
`update_event`, `find_free_slots`), but there's no UI to invoke
them, no inbox action that ties an email to a meeting, and no
standalone Calendar screen. Today the agent makes a promise the
system can't keep.

## Scope

Three threads, in order of dependency:

### A. Standalone Calendar screen

A new shell screen at `/calendar` that lists upcoming events for the
signed-in user's primary calendar.

- Default view: agenda (chronological list, today + next 14 days).
  Optional later: week / month grid.
- Each row: title, start–end, attendees (avatars / count), location
  / video link, source-icon (Google calendar id).
- Click → detail pane (mirroring the inbox two-pane layout) with
  full description, attendees with response status, agenda items if
  any.
- "+ New event" button → modal form (title, datetime range,
  attendees, description, conferencing toggle).
- Connect-prompt empty state if no Google connector wired
  (matches the inbox empty-state pattern).

### B. Inbox action: "Schedule meeting"

In the inbox detail pane, alongside the Reply / Archive / Snooze
toolbar, add a "Schedule" button that opens a slot-picker modal.

The modal:
1. Pre-fills attendees from the email's `From` + `Cc` addresses.
2. Pre-fills title from a sensible derivation of the email subject
   ("Quick chat about Hebbs for our agency next quarter?" →
   "Quick chat: Hebbs / agency Q4").
3. Calls `find_free_slots` for the next N business days (default 7,
   configurable per call).
4. User picks a slot, optionally edits title / description / video.
5. Submit → `create_event` + auto-reply via `send_email` with the
   confirmed slot in the body.
6. Stamps `metadata.scheduledMeeting = { eventId, startsAt, endsAt }`
   on the inbox item so the UI can show "🗓 Meeting scheduled" the
   next time the user opens it.

### C. Replier agent: include a proposed slot

The drafting agent today writes "I'll check my calendar." Better:
the agent calls `find_free_slots` itself and includes 2–3 concrete
slots in the draft body. Trade-off: agent latency goes up (extra API
call) and the user might not want the agent committing time on their
behalf. So:

- **Default:** agent does NOT call `find_free_slots`; the draft is
  generic "I'll send you times shortly." The user uses the inbox
  Schedule action (B) to commit.
- **Opt-in via tenant setting** `inbox.replier.proposeSlots = true`:
  agent fetches 3 slots and drops them into the draft. The user
  edits / accepts before sending.

Setting lives in `tenant_settings`; surfaced under the admin
settings UI (see [`task_04`](task_04_admin_settings_cron_workflow.md)).

## Reverse sync

Calendar events created or modified directly in Google should reflect
back in the Hebbs Calendar screen on the next tick. Two options:

1. **Webhook (Google Calendar push notifications):** real-time, but
   needs a per-tenant Pub/Sub channel and renewal every 7 days. Out
   of scope for v1.
2. **Polling via `events.list?syncToken=`:** identical pattern to
   `users.history.list` on Gmail (see
   [`done/task_01_gmail_sync_actions.md`](done/task_01_gmail_sync_actions.md)).
   Persist the syncToken on `connectors.config.calendar.syncToken`,
   poll every 5 minutes via a new ticker.

Recommend option 2 to start.

## Schema changes

None required. Calendar events live in Google. Inbox-side state
("this item triggered a meeting") rides on `inbox_items.metadata`.

If we later want a Hebbs-side cache of upcoming events for fast UI
reads, add an `events` table — but that's a v2 optimization, not a
blocker.

## Files in scope

- `packages/@boringos/connector-google/src/calendar-client.ts` —
  verify `find_free_slots` works against real availability (was
  written but never exercised end-to-end).
- `packages/@boringos/shell/src/screens/Calendar/` (new) — agenda
  list + detail + new-event modal.
- `packages/@boringos/shell/src/screens/Inbox/InboxDetail.tsx` —
  add Schedule button to ActionToolbar.
- `packages/@boringos/shell/src/screens/Inbox/ScheduleMeetingModal.tsx`
  (new) — slot picker, attendee chips, confirm.
- `packages/@boringos/shell/src/lib/router.tsx` (or equivalent) —
  wire `/calendar` route + sidebar entry.
- `packages/@boringos/core/src/inbox-google-calendar-sync.ts` (new) —
  poll ticker for reverse calendar sync.
- `packages/@boringos/core/src/boringos.ts` — wire the new ticker.

## Open questions

- **Multi-calendar selection**: a user may have a personal calendar
  and a work calendar both connected. Default to "primary" only for
  v1; expose a calendar picker in settings later.
- **Time-zone handling**: the agent in (C) needs the user's TZ to
  give meaningful slots. Pull from the user's Google calendar
  settings (`calendar.settings.list`) on first connect, cache on
  `users.tz` (new column or under `tenant_settings`).
- **Conflict with attendees' calendars**: `find_free_slots` only
  knows about the connected user's calendar. For external attendees
  (Mira), we propose times and they pick — we can't see their
  conflicts. State this clearly in the slot picker UI.
- **Replier slot-proposal opt-in default**: should it default to
  ON for power users / OFF for new tenants? Lean OFF — quieter is
  better until the user trusts the agent's calendar judgment.

## Why this is a blocker

The replier already drafts replies that promise calendar action. If
we ship inbox without follow-through on those promises, every
qualified-lead reply Hebbs sends starts with a credibility gap
("Hebbs said it'd send times — never did"). Calendar isn't optional
once email is the front door.

Order of implementation: A (standalone screen, low risk, lets the
user use Hebbs for calendar at all) → B (inbox action, ties to the
existing inbox flow) → C (agent slot proposal, behavior change for
the replier, gated by a tenant setting).

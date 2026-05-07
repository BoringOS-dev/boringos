# Blocker — Sync inbox actions with Gmail (archive / read / snooze / reverse)

## Problem

Today, archive / mark-read / mark-unread / snooze are **local-only**:
they mutate the `inbox_items` row but never touch the underlying
Gmail message. So a user who archives in Hebbs still sees the email
sitting in their Gmail inbox — the two views diverge immediately.

For Hebbs to be a real inbox replacement (not just a mirror), every
state transition must propagate **both directions**: Hebbs → Gmail
when the user acts in Hebbs, and Gmail → Hebbs when the user acts in
Gmail directly (e.g., on mobile).

## Coverage of every inbox action

Cross-checked against the shell's action surface
(`packages/@boringos/shell/src/screens/Inbox/`):

| Inbox action      | Origin (UI)                          | Needs Gmail sync? | Direction |
| ----------------- | ------------------------------------ | ----------------- | --------- |
| Archive           | per-item button + bulk               | yes               | both ways |
| Mark read         | auto on click + bulk                 | yes               | both ways |
| Mark unread       | per-item button + bulk               | yes               | both ways |
| Snooze            | per-item snooze menu                 | yes               | Hebbs→Gmail (reverse N/A; Gmail has no snooze API) |
| Snooze wake       | background ticker on `snoozeUntil`   | yes               | Hebbs→Gmail |
| Convert to task   | per-item button                      | no — email stays in Gmail inbox; Hebbs-internal task creation only | — |
| Reply             | composer modal                       | already wired (Gmail `send_email`) | Hebbs→Gmail |
| Reclassify        | triage menu                          | no — Hebbs-internal triage           | — |
| Discard draft     | draft card                           | no — Hebbs-internal metadata         | — |

Bulk variants (`handleBulkArchive`, `handleBulkMarkRead`,
`handleBulkMarkUnread` in `Inbox/index.tsx`) call per-item handlers
in a loop, so they pick up the sync automatically once per-item is
wired.

## Hebbs → Gmail (one-way action propagation)

For `item.source === "google.gmail"`:

| Hebbs action       | Gmail equivalent                              |
| ------------------ | --------------------------------------------- |
| Archive            | Remove `INBOX` label (`modify_email`)         |
| Mark read          | Remove `UNREAD` label                         |
| Mark unread        | Add `UNREAD` label                            |
| Snooze             | Remove `INBOX` label + add `Hebbs/Snoozed`    |
| Snooze wake (auto) | Re-add `INBOX` label, remove `Hebbs/Snoozed`  |

### Implementation outline

1. **Add `modify_email` action to `@boringos/connector-google`**
   - Inputs: `messageId: string`, `addLabelIds?: string[]`, `removeLabelIds?: string[]`
   - Wraps `users.messages.modify` on Gmail API
   - Already covered by the existing `gmail.modify` scope — no consent re-prompt needed

2. **Resolve `messageId` from inbox item**
   - Stored on the inbox item's metadata as `metadata.id` (Gmail RFC-822 id) by
     `connector-google`'s post-fetch enrichment in `gmail-client.ts`. Confirm
     the field name when wiring (some flows nest under `metadata.messageId`).
   - If missing, skip the sync (don't fail the local action).

3. **Server-side hooks in admin inbox routes** (`packages/@boringos/core/src/admin-routes.ts`)
   - `POST /inbox/:id/archive` → after the local update, if source is
     `google.gmail`, call `actionRunner.execute` with `modify_email`
     `{ removeLabelIds: ["INBOX"] }`
   - `PATCH /inbox/:id` (status transitions) → branch on the new status:
     - `read` → remove `UNREAD`
     - `unread` → add `UNREAD`
     - `snoozed` → remove `INBOX`, add `Hebbs/Snoozed` (lazy-create label)
   - Snooze ticker (`packages/@boringos/core/src/inbox-snooze-ticker.ts`) →
     on wake, re-add `INBOX` + remove `Hebbs/Snoozed`
   - `POST /inbox/:id/create-task` → no Gmail sync; the email stays in
     the user's Gmail inbox while a Hebbs task is created alongside.

4. **Lazy label creation**
   - First time a tenant snoozes anything, create `Hebbs/Snoozed` via
     `users.labels.create`. Cache the label id on the connector row's
     `config.labels.snoozed` so we don't re-fetch every call.

5. **Failure handling**
   - Local update is the source of truth — if Gmail sync fails (network,
     401, invalid message), log a warning but DO NOT roll back the local
     state. The user clicked archive; they expect it gone.
   - Surface a small "out of sync with Gmail" badge on items where the
     last sync attempt failed (cosmetic; can ship later).

## Gmail → Hebbs (reverse sync)

User archives / reads / labels in Gmail directly (mobile, desktop
client). Hebbs needs to reflect those changes without forcing the
user to act twice.

### Approach: poll diffs on every sync tick

The Gmail sync workflow already runs every 15 minutes. Extend it
beyond "fetch new messages" to also detect state changes on
existing messages:

1. **List recently-modified messages** — `users.history.list` with the
   `historyId` from the last sync. Returns labelAdded / labelRemoved /
   messageDeleted events since that cursor.
2. **Persist `historyId` per tenant** in the connector row's
   `config.gmail.lastHistoryId`. First sync seeds it from the
   `historyId` of the most recent fetch.
3. **Apply diff to inbox items** by Gmail message id:
   - `INBOX` label removed → set `inbox_items.status = 'archived'`
   - `UNREAD` label added → `status = 'unread'`
   - `UNREAD` label removed → `status = 'read'`
   - Message deleted → soft-delete (set `status = 'archived'`, mark
     `archivedAt`, no Gmail sync back)
4. **Conflict resolution** — if Hebbs has a more recent local mutation
   (`updatedAt > sync_started_at`), prefer local. The Hebbs→Gmail sync
   from step (3) above will reconcile on the next user action.

### Push vs poll

Gmail offers push notifications via Pub/Sub. Out of scope here —
poll is good enough for the first cut and keeps deployment simple
(no Pub/Sub topic provisioning per tenant). Revisit if 15-minute
latency feels too slow in practice.

## Open questions

- Use a dedicated `Hebbs/Snoozed` label, or rely on Gmail's native
  snooze? Native snooze is opaque (no API to set or read), so
  dedicated label is the realistic option.
- Should "mark read" sync immediately on click, or batch (read state
  changes rapidly during scroll-through)? Lean toward immediate —
  Gmail's modify API is cheap and the user expectation is "act fast,
  the world catches up."
- How to handle the user opening the same message in Gmail and Hebbs
  in parallel? Last write wins per field; in practice Gmail's `read`
  is idempotent so the race is benign.

## Files in scope

- `packages/@boringos/connector-google/src/gmail-client.ts` — add `modify_email` action
- `packages/@boringos/connector-google/src/connector.ts` — register the new action
- `packages/@boringos/connector-google/src/default-workflows.ts` — extend the Gmail sync workflow to call `history.list` and apply diffs
- `packages/@boringos/core/src/admin-routes.ts` — sync hook on `archive`, `update` (status transitions), `create-task`
- `packages/@boringos/core/src/inbox-snooze-ticker.ts` — wake path re-adds `INBOX`
- `packages/@boringos/connector-google/src/skill.md` — document `modify_email` for agents

## Why this is a blocker

Without this, every Hebbs user is forced to do every action twice
(once in Hebbs, once in Gmail) or live with permanent divergence.
Reverse sync is the more important half: if a user archives 50
emails on their phone in Gmail, Hebbs still shows them all as
unread the next morning. That defeats the central pitch — that
Hebbs is *the* inbox you live in.

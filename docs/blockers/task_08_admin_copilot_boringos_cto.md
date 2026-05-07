# Blocker (parked) — Admin Copilot / "BoringOS CTO"

**Status:** parked. Revisit after `task_07` (hierarchy + provenance) lands and after the user-scoped Copilot work establishes the privilege/scope plumbing.

## Why parked

The default Copilot is given to **every employee**. Granting it admin
API access means every employee gets admin power-by-proxy through
their Copilot. That's the wrong product shape for the everyday
assistant.

The right shape is two distinct copilot kinds:
- **User Copilot** (default, per employee) — acts with the user's
  scope. Sees what the user sees, does what the user can do. Covered
  by the user-scoped Copilot work.
- **Admin Copilot** ("BoringOS CTO" or similar) — only assigned to
  admin users. Has tenant-wide admin scope: manage agents, install
  apps, change settings, run migrations, manage routines/budgets,
  view audit log.

This split makes the privilege model match the org model: if you'd
trust a human admin with the action, you can trust their CTO Copilot
with it. If you wouldn't, you don't.

## What this task will eventually cover (do not implement now)

- A second built-in agent role: `boringos-cto` (or similar). Distinct
  persona, distinct privileges.
- Privilege column or grants table on agents: explicit
  `{ adminApi: true, ... }` set only for the CTO.
- Spawn-time: mint a per-run admin-scoped JWT (not the actual admin
  key — same security model as the callback token, different scope).
  Inject as `BORINGOS_ADMIN_TOKEN`. Admin middleware accepts it the
  same way as `X-API-Key`.
- Seed: tenant provisioning creates a CTO Copilot **only when**
  there's an admin user, or assigns it on first admin login.
  Definitely not auto-created for every user.
- Approval gating for destructive admin ops invoked by an agent —
  wire the existing `approvals` table into admin middleware when the
  caller is an agent token, on a configurable list of action types.
- Distinct UI surface: admins get a "CTO" thread separate from their
  user Copilot; non-admins never see it.

## Dependencies

- `task_07` (hierarchy + provenance) — the CTO is a `source='shell'`
  agent at the org root or just under CoS, and its presence has to
  be queryable.
- The user-scoped Copilot work — establishes the pattern of minting
  per-run scoped tokens for agents (admin token reuses the
  mechanism).

## Open questions (for when this unparks)

- One CTO per tenant or one per admin user? Lean: one per tenant,
  multi-admin tenants share. Avoids quorum questions.
- CTO under CoS or peer to CoS at the root? Lean: under CoS — CoS
  remains the structural root, CTO is functionally specialised.
- Does the CTO get codebase access (the persona's old "build"
  promise)? Probably yes for self-hosted/dev tenants, no for managed
  cloud — gate via tenant config.
- How does the CTO authenticate destructive ops to the human admin
  before executing? Approvals queue, Slack confirm, in-thread
  inline-approve, or all of the above?

## Why this is a blocker (eventually)

Because the framework's universal "Chief of Staff" prompt block
already hints at coordination, and the persona text on the default
Copilot already claims admin powers, real users will keep asking
their everyday Copilot to do admin things — and we'll keep saying
"sorry, can't." Naming and shaping a separate CTO Copilot lets us
say yes correctly: yes for admins, no for everyone else, with a
clear UI surface that matches the privilege.

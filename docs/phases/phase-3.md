# Phase 3 — Second App + Canonical Entities + Shell Completion

> Build Accounts as the second first-party app using only the public SDK. Promote `entity_refs` to canonical entities. Ship the Connectors OAuth UX that Phase 2 missed. Replace every shell placeholder so the product is end-to-end manually testable.

**Goal:** Prove the SDK is right by building something it was *not* designed around (Accounts), force canonical entities before three apps duplicate Person/Company data, and finish every Phase 1/2 UI gap so a fresh tenant can use the product without hitting "this lands later".

**Phase 3 Gate:** A fresh tenant signs up, lands on Home, opens **Connectors** → connects real Gmail via OAuth → emails sync into Inbox → generic-triage classifies + generic-replier drafts in parallel → user installs CRM via Apps → CRM email-lens enriches the SAME inbox item without re-classifying → user installs **Accounts** (built only with the public SDK) and is prompted to grant `entities.crm:read` → user closes a deal in CRM → Accounts auto-drafts an invoice linked to that deal via `entity_refs` → copilot answers questions across BOTH apps simultaneously → uninstalling CRM warns about Accounts dependency. All shell placeholder screens (Copilot, Approvals, Drive, Activity, Team) render real data. Manual test plan in `docs/tests/test_phase3.md` walks every step end-to-end.

**Phase 3 Risk:** if Accounts requires SDK changes, the SDK contract is wrong — pause and fix the SDK before opening third-party in Phase 4. The canonical-entity promotion is also a contract risk: if existing CRM has to break to use the canonical layer, the canonical model is wrong.

---

## Workstreams

| Code | Workstream | Outcome |
|---|---|---|
| **N** | Connectors UI | Gmail/Slack OAuth round-trip from inside the shell. Replaces the placeholder. The biggest gap left by Phase 2. |
| **O** | Canonical entities | `canonical_persons` + `canonical_companies` first-class. CRM Contact = Accounts Customer = canonical Person via `entity_refs`. |
| **P** | Cross-app capability flow | `entities.{otherApp}:read` declared at install, prompted at install, enforced at runtime, surfaced on uninstall cascade. |
| **Q** | Accounts app *(scope checkpoint Q0 — discuss before any Q1 work)* | Built from scratch using only `@boringos/app-sdk`. Default scope is thin AR (invoices auto-drafted from closed deals + payment reconciliation). Confirm scope vs alternatives (Support, Scheduling, broader Accounts) before starting. |
| **R** | Cross-app event flow | CRM emits `crm.deal_won` → Accounts drafts invoice. `invoice.paid` annotates CRM deal. Bidirectional `entity_refs` link. |
| **S** | Shell screen completion | Replace all remaining placeholders: Copilot conversation UI, Approvals, Drive (browser + skill editor), Activity log, Team management. Plus: Notifications dropdown, Inbox detail + actions, Onboarding wizard. |
| **T** | Phase 3 Gate | End-to-end timing benchmark, real Gmail manual run, cross-app prompt verification, uninstall cascade verification, copilot multi-app, SDK regression, manual `test_phase3.md`. |

Detail in [`docs/build/tasks-phase-3.json`](../build/tasks-phase-3.json) — 46 tasks, ~140 hours, sequential execution per `docs/build/way-to-implement.md`.

---

## What this phase closes from Phase 1/2

| Gap | How it's closed |
|---|---|
| Connectors page is a placeholder | N1–N7 |
| No way to OAuth Gmail/Slack from inside the shell | N1–N4 |
| No default Gmail sync workflow on connect | N5 |
| Approvals screen placeholder | S2 |
| Drive screen placeholder | S3, S4 |
| Activity screen placeholder | S5 |
| Team screen placeholder | S6 |
| Copilot screen placeholder ("conversation UI lands in a follow-up") | S1 |
| Inbox shows filter only — no detail / actions | S8 |
| No notifications surface | S7 |
| No onboarding for new tenants | S9 |
| Cross-app entity sharing is ad-hoc | O1–O6 |
| No way for one app to declare it needs entities from another | P1–P4 |
| Zero proof the SDK works for non-CRM apps | Q1–Q8 |

## What this phase does NOT close (deferred to Phase 4)

- Marketplace browse + publish (third-party apps)
- Signed-bundle pipeline + verification
- Public dev portal
- App update channels
- 2nd connector built by a third party (Phase 4 vets the connector SDK the same way Q vets the app SDK)

## What this phase does NOT close (deferred to Phase 5)

- Billing rails, revenue share, paid apps
- Enterprise tier (SSO/SCIM/audit retention)
- App bundles + categories

---

## Why these letters

Phase 1 used A–E, Phase 2 used K–M (jumping the alphabet to mark a clean break after the SDK froze). Phase 3 continues N–T sequentially, with **T as the gate** following the convention that gates are the last workstream of the phase.

---

## Read order before starting

1. [docs/coordination.md](../coordination.md) — events / workflows / handover model (binds N+R)
2. [docs/capabilities.md](../capabilities.md) — capability namespace and wildcards (binds P)
3. [docs/app-sdk.md](../app-sdk.md) — current public surface (binds Q + O6)
4. [docs/build/tasks-phase-3.json](../build/tasks-phase-3.json) — the actual task list with `dependsOn` chains
5. [docs/tests/phase2-gate-results.md](../tests/phase2-gate-results.md) — what shipped and why M5 (SDK regression) is the model for T6

---

*Last updated: 2026-05-05*

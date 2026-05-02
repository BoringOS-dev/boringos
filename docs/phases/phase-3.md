# Phase 3 — Second App + Canonical Entities

> Build a second first-party app from scratch using only the public SDK. Promote `entity_refs` to first-class.

**Goal:** Prove the SDK is right by building something the SDK was *not* designed around. Force canonical-entity status before three apps duplicate "person" and "company" data.

**Phase 3 Gate:** CRM and Accounts run side-by-side cleanly. A deal closes in CRM → Accounts drafts an invoice automatically. Uninstalling either app surfaces the dependency to the user. Copilot answers questions across both apps simultaneously. **If we had to bend the SDK to fit Accounts, we got the contract wrong — fix before opening third-party.**

---

## Workstreams (sketch)

| Code | Workstream | Outcome |
|---|---|---|
| **K** | Canonical entities | `entity_refs` first-class; CRM Contact = Accounts Customer = canonical Person |
| **L** | Cross-app capability flow | `entities.{other_app}:read` declared, install-time prompt, runtime enforcement, uninstall cascade warning |
| **M** | Accounts app | Schema (`fin_invoices`, `fin_payments`, `fin_chart_of_accounts`), agents (Invoice Drafter, Payment Reconciler), workflow templates, UI slots |
| **N** | Cross-app event flow | Accounts subscribes to `crm.deal_won`, drafts invoices linked to source Deal |
| **O** | Second marketplace listing | Accounts published alongside CRM |

Detail comes when Phase 2 is closed.

---

*Last updated: 2026-05-03*

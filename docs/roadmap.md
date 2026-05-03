# Roadmap

> The build sequence — what ships when, and the reasoning behind each phase.

This is the public roadmap for BusinessOS. It captures the order, the gates between phases, and the goals at each milestone. It is updated as the platform progresses, but the **principles** (Section 1) do not change without explicit team review.

**Audience:** Contributors, partners, investors, third-party developers planning when to build.
**Read first:** [Overview](./overview.md) — especially Section 6 (Build Approach).

---

## 1. Principles That Drive the Sequence

These are not negotiable per-release. PRs and feature requests are evaluated against them.

1. **Ship the platform before the product.** The shell is a usable product on its own — fully agentic with no apps installed. CRM is not a launch dependency for the shell.
2. **One app at a time, contract-first.** Each new app proves whether the SDK is stable. If we have to bend the contract for an app, the contract is wrong. Two apps coexisting cleanly is the test of platform-readiness.
3. **First-party paves the road, third-party walks it.** First-party apps (CRM, Accounts, Sales, Finance) are built using the *public* SDK as a third party would. No backdoors, no internal-only APIs.
4. **Broad beats niche.** The platform owns the orchestration layer; vertical apps are content. Resist any pull to ship vertical-only without the platform.
5. **Marketplace is a moat earned, not declared.** The third-party marketplace opens after two first-party apps coexist cleanly — proving the contract works for unrelated developers.

---

## 2. Phase 0 — Foundation (Complete)

Status: **shipped**.

The runtime kernel exists and is functional. From the framework scan:

- Multi-tenant by default (`tenantId` on every table)
- 6 runtime adapters: Claude CLI, Codex, Gemini, Ollama, command, webhook
- Agent execution pipeline with 12 personas, persona aliases, hierarchy
- DAG workflow engine with 9 native block types + visual editor
- Event bus, connector framework, OAuth + webhook infrastructure
- Memory provider (Hebbs), drive (file storage with memory sync)
- Task model (status, priority, parent/sub, comments, work products, locks)
- Auth (multi-tenant signup, invites, teams), JWT callbacks, SSE realtime
- Activity log, budget enforcement, routine scheduler, approvals queue
- 126 framework tests passing

CRM exists as a proof of concept domain app on top of this runtime — but it currently owns its own SPA, which is what Phase 1 corrects.

---

## 3. Phase 1 — Shell Extraction (Q2 2026)

**Goal:** Ship `@boringos/shell` as a usable, alpha-launched product. Zero apps installed; fully agentic out of the box.

**Workstreams:**

- `shell-extraction-1` — Lift shared chrome (layout, sidebar, command bar, copilot dock, auth screens) out of `boringos-crm/packages/web` into a new `@boringos/shell` package
- `shell-extraction-2` — Define and implement the slot system: `nav`, `dashboard.widget`, `entity.action`, `entity.detail`, `settings.panel`, `command.action`, `copilot.tool`, `inbox.handler`
- `shell-screens-1` — Implement the 13 shell-owned screens (Home, Copilot, Inbox, Tasks, Agents, Workflows, Drive, Connectors, Apps, Team, Settings, Activity, Approvals)
- `shell-screens-2` — Build the **Apps screen** (the killer screen): Browse / Installed / Updates / Install from URL
- `tenant-apps-registry` — `tenant_apps` and `tenant_connectors` tables; install / activate / upgrade / uninstall lifecycle; capability storage and runtime checks
- `app-sdk-v1` — Publish `@boringos/app-sdk` and `@boringos/connector-sdk` v1; freeze the manifest contract
- `default-apps` — Build **Generic Inbox Triage** and **Generic Email Replier** as pre-installed first-party default apps using the public SDK. Without these, a fresh tenant has nothing useful out of the box. They follow the regular install / disable / uninstall lifecycle (uninstallable, not shell core). See [coordination.md](../coordination.md) for the rationale.
- `connector-migration` — Migrate `connector-slack`, `connector-google` to the new manifest + capability format. Migrate action I/O from `ActionFieldDef` to JSON Schema. Add CI verification job. **Phase 1 cannot exit until existing connectors pass the same checks third-party connectors will pass.** See [migrate-existing-connectors.md](./developer/migrate-existing-connectors.md).
- `dev-tooling` — `create-businessos-app` and `create-businessos-connector` scaffolders; local dev sandbox; test harness packages

**Phase 1 Gate:** A fresh tenant can sign up, connect Gmail, build a workflow that wakes an agent on incoming email, and ship work — with zero apps installed.

**Phase 1 Out of Scope:** marketplace UI for browsing third-party apps (that's Phase 4); paid apps and billing (Phase 5).

---

## 4. Phase 2 — CRM Port (Q3 2026)

**Goal:** Re-implement CRM against the *public* App SDK as a third party would. Prove the contract works.

**Workstreams:**

- `crm-port-1` — Strip the CRM SPA's chrome (router root, sidebar, top bar, auth, copilot host); domain components (DealForm, DossierView, PipelinePage) survive
- `crm-port-2` — Re-register all UI contributions through manifest slots: Pipeline → `nav`; DossierView → `entity.detail` for `crm_contact`; "Send follow-up" → `entity.action` on Deal
- `crm-port-3` — Server-side: `defineApp` registration, schema migrations, `onTenantCreated` provisioning
- `crm-marketplace-listing` — First marketplace listing (single app: CRM by BusinessOS)
- `crm-public-beta` — Public beta of CRM running on the shell; design partners migrated

**Phase 2 Gate:** A fresh tenant can install CRM from the shell's Apps screen in under 30 seconds. CRM nav entries appear; agents seed; copilot picks up CRM context. **If the port required modifying the SDK, the contract is wrong — fix and re-port.**

**Phase 2 Risk:** if CRM cannot be ported using only the public SDK, we have a Phase 1 gap. Resolve before moving forward.

---

## 5. Phase 3 — Second App + Canonical Entities (Q4 2026)

**Goal:** Build a second first-party app from scratch using the public SDK. Prove the contract is right by building something the SDK was not designed around.

**Choice of second app:** **Accounts** (invoicing + financial records). Reasoning: invoices reference deals, customers reference contacts — this forces the framework's `entity_refs` to first-class status. Without a canonical entity layer, CRM and Accounts will duplicate "person" / "company" data and the suite will feel like two separate products.

**Workstreams:**

- `entity-refs` — Promote cross-entity refs to first-class. CRM Contact = canonical Person. Accounts Customer = canonical Person (linked, not duplicated).
- `cross-app-deps` — Implement the cross-app capability flow: declared dependency, install-time prompt, runtime enforcement, uninstall cascade warning
- `accounts-app` — Built ground-up on the SDK. Schema (`fin_invoices`, `fin_payments`, `fin_chart_of_accounts`), agents (Invoice Drafter, Payment Reconciler), workflow templates, UI slots
- `accounts-cross-crm` — Accounts subscribes to `crm.deal_won` event, drafts invoices linked to the source Deal
- `accounts-marketplace-listing` — Second marketplace listing

**Phase 3 Gate:** Both CRM and Accounts run side-by-side cleanly. A deal closes in CRM → Accounts drafts an invoice automatically; uninstalling either app surfaces the dependency to the user; copilot answers questions across both apps simultaneously. **If we had to bend the SDK to fit Accounts, we got the contract wrong — fix before opening third-party.**

---

## 6. Phase 4 — Marketplace Open (Q1 2027)

**Goal:** Open the SDK and marketplace to third-party developers. The platform becomes an ecosystem.

**Workstreams:**

- `marketplace-backend` — Submission queue, automated review pipeline, human review tooling, signed bundle distribution, CDN
- `marketplace-ui` — Marketplace browse/listing/install pages in the shell; ratings, reviews, install counts, verified-publisher badges
- `dev-portal` — Public developer portal: docs, API references, publisher onboarding, key management, submission status, analytics
- ~~`remote-app-runtime`~~ — **Deferred.** All apps run in-process in v1. Remote-app runtime is opened only when a real third-party use case requires custom infra or stronger sandboxing. Marketplace can ship without it; third-party apps run in-process for now.
- `signed-bundles` — Publisher key generation, bundle signing, signature verification at install
- `app-update-channels` — Auto-patch / manual / locked channels; capability-diff prompts on major updates

**Phase 4 Gate:** External developers can scaffold, build, test, publish, and install a third-party app or connector without any platform-team intervention. The first 10 third-party listings are live.

**Phase 4 Out of Scope:** paid third-party apps and revenue share (Phase 5).

---

## 7. Phase 5 — Commercial Layer (Q2 2027)

**Goal:** Monetization. Both first-party paid apps and third-party paid apps work.

**Workstreams:**

- `billing-rails` — Per-seat billing for the shell, per-app billing for paid apps, usage metering for usage-priced apps
- `revenue-share` — Shopify-style revenue share for third-party paid apps (30% → 15% at scale)
- `enterprise-tier` — SSO, SCIM, audit log retention, IP allowlist, custom roles, private app registry for internal-only apps
- `marketplace-categories` — Curated categories, featured listings, editorial reviews
- `app-trials` — Free trial mechanics for paid apps; auto-conversion or auto-disable on expiry
- `app-bundles` — "BusinessOS Suite" first-party bundle (CRM + Accounts + Sales) at a discount

**Phase 5 Gate:** First paying customers on the shell; first paying installs of paid apps; first revenue-share payouts to third-party publishers.

---

## 8. Phase 6 — Scale (Late 2027 onwards)

Open-ended. Things on the long-term horizon, not yet scoped:

- **Federated runtime.** Process boundaries between apps for tenants that need it (regulatory isolation, GPU access, custom infra)
- **App composability primitives.** App-to-app SDK calls (Accounts asks CRM directly, not via events)
- **Domain-app templates.** "Start an app from a template" — pre-wired schema + agents + workflows for common verticals (legal, real estate, healthcare)
- **Self-improving tenants.** The OS observes the tenant's patterns, proposes workflows and agents automatically, learns
- **Foundation governance.** Donate the runtime kernel to a foundation; keep the shell + apps as commercial focus
- **International / regional hosting.** EU / APAC data residency

---

## 9. Goals at Year-End (2026)

By December 2026:

- Shell live in public beta, used by **N tenants**
- CRM and Accounts available as first-party apps
- App SDK v1 frozen; v1.1 minor improvements deployed
- 5+ third-party apps in development (closed-beta partners)
- 100+ paying tenants on the shell
- First-party CRM revenue covering 30%+ of platform run-rate

These targets refine as we get closer.

---

## 10. What's Not on the Roadmap

Things we deliberately do not build, or defer indefinitely, to stay focused:

- A help-desk / ticketing app (someone will build it as a third-party)
- A document editor (Drive ships file storage; editing delegated to native apps and future installable apps)
- A "no-code" workflow builder targeted at non-developers (the existing DAG editor is the workflow surface; no parallel drag-and-drop builder)
- Mobile-native shell apps (web-responsive shell is sufficient; native shell is a 2028+ consideration)
- Voice / phone-call agentic surface (could be a connector + app combination, but not built first-party)

---

## 11. Reading Order From Here

- [Overview](./overview.md) — the architecture this roadmap implements
- [App SDK Reference](./app-sdk.md) — the contract Phase 1 freezes
- [Building Apps](./developer/building-apps.md) — what Phase 4 enables for third parties

---

*Last updated: 2026-04-30*

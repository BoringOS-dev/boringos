# Migrating Existing Connectors to the Right Architecture

> The existing connectors (`connector-slack`, `connector-google`, GitHub plugin) predate the manifest + capability contract. This document captures why we migrate them, what changes, and how — without breaking what works today.

**Status:** Plan, not yet executed. No code changes proposed in this doc.
**Audience:** Platform team executing the migration; reviewers signing off on the contract.
**Read first:** [Building Connectors](./building-connectors.md), [Capabilities](../capabilities.md), [App SDK Reference](../app-sdk.md).

---

## 1. Why We Migrate

The existing first-party connectors are working code. They could be left alone. We are choosing not to leave them alone, for one reason:

> **The migration of the existing connectors is the test of whether the new format is right.**

If `connector-slack` and `connector-google` cannot be cleanly migrated to the manifest + capability format, the format is wrong. We want to discover that before any third party builds against it. The reference implementations have to use the same contract third parties will use — otherwise we end up with two formats forever, the "internal" one with shortcuts and the "external" one nobody reads, and the external one rots from underuse.

This is the same principle the overview doc applies to apps:

> *"Port CRM as the proof, not as a co-build."*

Apply it one level down. **Port the connectors as the proof, not as a co-build.**

---

## 2. What Exists Today

The current `ConnectorDefinition` (in `boringos-framework/packages/@boringos/connector/src/types.ts`):

```ts
interface ConnectorDefinition extends SkillProvider {
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  oauth?: OAuthConfig;
  events: EventDefinition[];
  actions: ActionDefinition[];
  setup?(ctx: ConnectorContext): Promise<void>;
  handleWebhook?(req: WebhookRequest): Promise<WebhookResponse>;
  createClient(credentials: ConnectorCredentials): ConnectorClient;
}
```

Connectors are exported as **factory functions**:

```ts
export function slack(config: SlackConfig): ConnectorDefinition { /* ... */ }
```

Consumed by the framework via:

```ts
app.connector(slack({ signingSecret: process.env.SLACK_SIGNING_SECRET }))
```

What does **not** exist today:

- A `boringos.json` manifest at the connector package root
- Capability declarations
- JSON Schema for action inputs/outputs (uses framework's own `ActionFieldDef`)
- Multiple auth types (only OAuth)
- Webhook path declarations (single `handleWebhook` method routes everything)
- Build-time verification that the connector definition matches its declarations

---

## 3. The Target Architecture

Two layers, clean separation:

### Layer 1 — TypeScript ConnectorDefinition (unchanged)

The factory function and `ConnectorDefinition` shape survive intact. This is what the framework runtime consumes.

### Layer 2 — `boringos.json` manifest (new, additive)

A JSON manifest at the connector package root, parsed by the shell at install time. Declares identity, version, publisher, capabilities, and references the compiled bundle that exports the `ConnectorDefinition`.

```json
{
  "kind": "connector",
  "id": "slack",
  "version": "1.0.0",
  "name": "Slack",
  "description": "Send and receive messages in Slack channels and threads.",
  "publisher": { "name": "BoringOS", "verified": true },
  "entry": "dist/index.js",
  "capabilities": [
    "auth:oauth:slack",
    "events:emit:slack.*",
    "actions:expose:3",
    "webhooks:receive:/events",
    "network:outbound:slack.com"
  ],
  "minRuntime": "1.0.0",
  "license": "MIT"
}
```

The manifest is a **verifiable projection** of the `ConnectorDefinition`. At build time, CI checks that the manifest's claims match what the code actually does. Single source of truth in the TS code; manifest exists for marketplace discovery and capability enforcement.

---

## 4. What Stays vs What Changes

| Aspect | Stays the same | Changes |
|---|---|---|
| Factory-function pattern (`slack(config)`) | ✓ |  |
| `ConnectorDefinition` field shape (`kind`, `name`, `events`, `actions`, etc.) | ✓ |  |
| Field names: `kind`, event `type`, action `name` | ✓ |  |
| Single `handleWebhook` method (internal routing) | ✓ |  |
| OAuth as primary auth path | ✓ |  |
| Consumer API (`app.connector(slack({...}))`) | ✓ |  |
| `boringos.json` at package root |  | **New** |
| Capability declarations |  | **New** |
| Action input/output schemas |  | Migrate `ActionFieldDef` → JSON Schema (or accept both) |
| Webhook paths in manifest |  | **New** (metadata only; routing stays in `handleWebhook`) |
| Build-time verification of manifest vs code |  | **New** (CI check) |
| Publisher metadata, version, license |  | **New** (manifest fields) |

**The existing TypeScript interface barely changes.** What we're adding is a layer above it (the manifest) and inside one field (JSON Schema for action I/O).

---

## 5. Per-Connector Migration Plan

### connector-slack — first to migrate

| Item | Detail |
|---|---|
| Surface | 3 events, 3 actions, 1 webhook handler |
| Auth | OAuth only |
| Why first | Smallest surface; minimal risk; fastest feedback loop on whether the format works |

**Specific work:**

1. Add `packages/@boringos/connector-slack/boringos.json`
2. Declare capabilities: `auth:oauth:slack`, `events:emit:slack.*`, `actions:expose:3`, `webhooks:receive:/events`, `network:outbound:slack.com`
3. Migrate the 3 actions' `inputs`/`outputs` from `ActionFieldDef` shape to JSON Schemas in `schemas/`
4. Declare webhook paths in manifest (purely metadata; `handleWebhook` continues to route internally)
5. CI verification job

**Decision points surfaced:**

- Manifest field names — do we use `id` (matching new convention) or `kind` (matching existing TS field)? Recommendation: keep `kind` everywhere. `id` was the wrong choice in my earlier draft.
- Action schema migration — accept both `ActionFieldDef` and JSON Schema in the framework, with new code encouraged to use JSON Schema? Or fully migrate? Recommendation: accept both; new manifest layer normalizes to JSON Schema for marketplace use; old `ActionFieldDef` continues to work in the framework.

### connector-google — second to migrate

| Item | Detail |
|---|---|
| Surface | Gmail (4 actions: list_emails, read, send, search) + Calendar (4+ actions: list_events, create, update, find_free_slots) |
| Auth | OAuth with combined scope set |
| Why second | Larger surface; tests whether multi-service connectors fit the format |

**Specific work:**

1. Add `packages/@boringos/connector-google/boringos.json`
2. Declare capabilities for both Gmail + Calendar event/action sets
3. Migrate all action I/O to JSON Schema
4. Two outbound network domains declared: `googleapis.com`, `accounts.google.com`

**Decision points surfaced:**

- **Should `connector-google` be split into `connector-gmail` + `connector-calendar`?** They share OAuth, which is the strongest argument for staying combined. They also represent two distinct service surfaces, which is the argument for splitting (a tenant might want Gmail without Calendar). Recommendation: stay combined for now; revisit at marketplace launch (Phase 4) when third parties may want fine-grained installs.
- **Skill files** (`@boringos/connector-google` ships skill markdown today — agentic instructions on how to use the connector). Where do these go in the manifest era? Recommendation: continue shipping them as part of the package; manifest references them with a `skills` field; copilot's context provider continues to inject them.

### GitHub plugin — possibly *not* a connector

The earlier scan classified GitHub as a **plugin**, not a connector. Today it uses cron-based polling rather than OAuth + webhooks. Need to decide which it is before migrating:

| If it's a connector | If it's a plugin |
|---|---|
| Migrate to manifest format with `auth:apikey` (PAT-based) + a `setup` hook that schedules polling | Leave alone for this migration; plugins are a separate extension type with their own future format |

**Recommendation:** treat it as a *plugin* for now (don't migrate as part of connector work), and later — when we formalize the plugin format — migrate it then. This keeps the connector migration focused on connectors.

---

## 6. Build-Time Verification

The migration is only complete when CI verifies, on every push to a connector package, that:

| Check | What it verifies |
|---|---|
| Manifest validity | `boringos.json` is well-formed, all referenced files exist |
| Events match | Manifest's declared event types match `ConnectorDefinition.events[].type` |
| Actions match | Manifest's declared action count matches `ConnectorDefinition.actions.length` |
| Auth match | `ConnectorDefinition.oauth?.scopes` ⊆ what `auth:oauth:{provider}` capability implies |
| Network honesty | All `fetch`/HTTP calls in the bundle target only domains declared via `network:outbound:*` |
| Action I/O schemas validate | Every JSON Schema in `schemas/` is itself valid JSON Schema and is referenced by the manifest |

This is the same check that will run on third-party connectors at publish time. **Running it on first-party connectors from day one is what prevents format drift.**

A manifest that claims more than the code does = warning (declared-but-unused capability). A manifest that claims less = error (undeclared call). The latter blocks merge.

---

## 7. Migration Order & Sequencing

Execute in this order. Each step gates the next.

1. **Define the manifest schema.** Publish `@boringos/connector-manifest-schema` (a JSON Schema for the manifest itself). Without this, no manifest can be validated.
2. **Add manifest verification CI job.** New connector packages must pass it; existing ones get a warning until migrated.
3. **Migrate `connector-slack`.** Smallest surface. Use it to discover format issues.
4. **Address discovered issues.** Iterate the manifest schema based on what slack migration revealed. Re-verify.
5. **Migrate `connector-google`.** Larger surface; tests multi-service handling.
6. **Address any new discovered issues.**
7. **Decide on GitHub plugin.** Migrate if classified as connector; defer if classified as plugin.
8. **Promote CI verification from warning → error.** Once all first-party connectors pass, the check becomes mandatory for all connector packages.

Estimated calendar time: 2–3 weeks for steps 1–7 with a single engineer; faster with two.

---

## 8. The Deeper Question: Should First-Party Connectors Live in Their Own Repos?

Today, `connector-slack` and `connector-google` live inside `boringos-framework/packages/`. They ship and version with the framework.

In the third-party world, every connector is its own repo, its own release cadence, its own publisher. **Eventually, first-party connectors should look the same** — independent repos consuming the published `@boringos/connector-sdk`, distributed through the marketplace like any third party would distribute. Same principle as first-party apps.

**But not yet.** Extracting connectors into their own repos before the marketplace exists adds operational overhead with no immediate payoff. The right sequencing:

| Phase | What changes for first-party connectors |
|---|---|
| **Phase 1** (now)  | Migrate to manifest format; stay inside the framework monorepo |
| **Phase 4** (marketplace open) | Extract first-party connectors into their own repos; publish via marketplace; same flow as third parties would use |

The Phase 1 migration is the **format change**. The Phase 4 extraction is the **distribution change**. Two distinct moves, sequenced separately.

---

## 9. Risks & Open Questions

### Risks

- **Format churn.** If the manifest schema changes during steps 3–6, existing migrated connectors need re-migration. Mitigation: keep the manifest minimal in v0; only add fields once a real connector needs them.
- **CI flakiness.** Static analysis of network calls (for `network:outbound:*` enforcement) is non-trivial; bundlers can hide HTTP calls behind dynamic imports. Mitigation: ban dynamic imports in connector bundles (already proposed in `publishing-and-install.md`).
- **Backwards compatibility.** Tenants currently running connectors via the old TypeScript-only API should be unaffected because Layer 1 doesn't change. But any framework code that *registers* connectors needs to handle "manifest present" and "manifest absent" until all are migrated. Mitigation: warning-level CI for the migration window; flip to error after step 7.

### Open questions

1. **Manifest field naming.** Do we keep `kind` (matches existing TS) or rename to `id` (matches what apps will use)? Recommendation in this doc: keep `kind` for connectors. Apps use `id`. They are different extension types.
2. **Skill files.** Where do existing connector skill files (markdown describing how agents should use the connector) fit in the manifest? Proposed: `"skills": ["./skills/gmail.md", "./skills/calendar.md"]` field. Copilot context provider reads them at install.
3. **Dual schema acceptance.** Do we accept both `ActionFieldDef` (legacy) and JSON Schema in `ConnectorDefinition.actions[].inputs/outputs`, or force migration? Recommendation: accept both; converter at the manifest layer normalizes to JSON Schema for marketplace.
4. **Publisher signing for first-party.** First-party connectors don't need a "verified publisher" badge to be trusted (they're shipped by us). But should they still go through the signing pipeline? Recommendation: yes — first-party uses the same publishing flow as third-party would. Otherwise the publishing flow is untested.

---

## 10. Success Criteria

The migration is complete when:

- [ ] `connector-slack` ships with `boringos.json`, all CI checks pass
- [ ] `connector-google` ships with `boringos.json`, all CI checks pass
- [ ] GitHub plugin's classification (connector vs plugin) is decided and acted on
- [ ] CI verification job is mandatory (error level) for every connector package
- [ ] At least one third-party developer (could be internal, simulating third-party) successfully scaffolds and publishes a connector using only the public manifest format and SDK — proving the contract works end-to-end

The last criterion is the real test. Until a "third party" walks the road first-party paved, we don't know if we paved it well.

---

## 11. Reading Order From Here

- [Building Connectors](./building-connectors.md) — the canonical format these connectors are migrating to
- [Capabilities](../capabilities.md) — the scope catalog connectors will declare against
- [Roadmap](../roadmap.md) — Phase 1 workstream where this fits
- [Publishing & Install](./publishing-and-install.md) — the publish pipeline first-party connectors will eventually use

---

*Last updated: 2026-04-30*

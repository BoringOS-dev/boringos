# Publishing & Install

> The mechanics of distributing connectors and apps to BoringOS tenants — and what happens under the hood when a user clicks Install.

This doc is shared between connectors and apps. Both follow the same registry, signing, and install pipeline. Differences are called out where they apply.

**Audience:** Developers publishing extensions; tenants installing them; security reviewers.
**Read first:** [Building Connectors](./building-connectors.md) or [Building Apps](./building-apps.md).

---

## 1. The Two Distribution Paths

| Path                       | Trust model            | Use when                                                 |
| -------------------------- | ---------------------- | -------------------------------------------------------- |
| **GitHub-as-registry**     | Unverified publisher   | Internal builds, beta releases, fast iteration, private repos |
| **Marketplace listing**    | Verified + signed      | Public distribution, vetted by review                    |

Both paths produce the same install experience under the hood — only the trust signaling and review gating differ. A single artifact can ship through both paths simultaneously (typical pattern: GitHub for beta, marketplace for stable).

---

## 2. The Manifest as Discovery Contract

Every published extension — connector or app — has a `boringos.json` at the repo root. This is what the shell reads first when discovering an extension.

The manifest's `kind` field determines the extension type:

```json
{ "kind": "connector", ... }
{ "kind": "app", ... }
```

The shell rejects manifests with unknown `kind` values. Future extension types (themes, runtimes, custom block types) will declare new `kind` values; old shells refuse to install them, prompting an update.

---

## 3. Path A — GitHub-as-Registry

### How publishing works

1. Build the artifact: `pnpm build` produces `dist/` (and for apps, also `web/dist/` and validated `schema/migrations/`).
2. Commit the build output if your repo is public, or set up a release workflow that builds on tag.
3. Tag a release matching the manifest version: `git tag v1.0.0 && git push --tags`.
4. The release must include:
   - `boringos.json`
   - `dist/` (server bundle)
   - `web/dist/` (UI bundle, apps only)
   - `schema/migrations/` (apps only)
   - `schemas/` (JSON Schemas referenced by manifest, connectors only)

### How install works

The user pastes a URL into "Install from URL" in the shell. Acceptable formats:

- `github.com/acme/my-stripe-connector` → resolves to latest tagged release
- `github.com/acme/my-stripe-connector@v1.0.0` → specific version
- `github.com/acme/my-stripe-connector#main` → latest commit on a branch (warns: unstable)
- A direct release URL: `github.com/acme/my-stripe/releases/tag/v1.0.0`

Under the hood, the shell:

1. Fetches `boringos.json` from the resolved release
2. Validates the manifest (schema-correct, capability declarations well-formed, `minRuntime` satisfied)
3. Fetches the rest of the artifact
4. **Computes a SHA-256 hash of the bundle** and stores it on the install record (so future updates can be diff-checked)
5. Shows the permission prompt — always with an **"Unverified publisher"** banner
6. On user approval, runs the install pipeline (see Section 5)

### Private repos

For internal apps, the user provides a GitHub access token at install time. The shell stores it tenant-scoped (encrypted) and uses it for fetches and update checks. No token = no install.

### Trust handling

GitHub-direct installs:

- Always show "Unverified publisher" warning
- Skip automated and human security review
- Run in-process like all other apps (v1; see [building-apps.md § 5](./building-apps.md))
- Are not listed in the marketplace
- Updates surface as notifications but require manual user approval — no auto-update

This is the escape hatch for power users and private builds. It is intentionally less convenient than the marketplace. Because GitHub-direct apps still run in-process, tenants installing untrusted GitHub URLs accept the same blast radius as installing any other app — a stronger reason to keep the "Unverified publisher" warning visible and to recommend marketplace-listed apps for production tenants.

---

## 4. Path B — Marketplace Listing

### Submitting

```
npx businessos publish
```

This CLI flow:

1. Builds and validates the manifest
2. Runs the test suite (must pass)
3. Generates a signed bundle (see Section 7)
4. Uploads to the marketplace submission queue
5. Triggers automated checks
6. Routes to human review if any sensitive scopes are requested

You provide submission metadata at first publish: publisher name, homepage, support contact, screenshots, longer description, category tags. These appear on the marketplace listing.

### Automated review checks

Run on every submission:

| Check                                | What it verifies                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Manifest validity                    | Schema-correct, all referenced files present in bundle                        |
| Capability honesty                   | Code only invokes SDK calls covered by declared capabilities                  |
| Network domain honesty               | Outbound HTTPS calls only to declared domains                                 |
| Banned APIs                          | No `eval`, no dynamic imports, no filesystem outside sandbox, no raw subprocess spawning |
| Bundle size                          | Server bundle ≤ 5 MB; UI bundle ≤ 2 MB compressed                             |
| Test suite                           | Test command exits 0; coverage ≥ minimum threshold (70%)                      |
| Schema migration correctness (apps)  | Migrations apply forward against a clean DB without errors                    |
| Schema validity (connectors)         | All emitted events and action I/O validate against declared JSON Schemas      |
| Cross-app dependency acyclicity      | No circular dependency chains                                                 |

A failing automated check blocks the submission with actionable error messages. You fix and resubmit.

### Human review triggers

Submissions that pass automated checks but request sensitive capabilities go to human review:

| Trigger                                             | Why                                              |
| --------------------------------------------------- | ------------------------------------------------ |
| Write access to financial APIs                      | Money-moving actions need explicit review        |
| Write access to email or messaging                  | Phishing / abuse vector                          |
| `entities.{other_app}:write` (cross-app writes)     | Could corrupt other apps' data                   |
| `connectors:register` from non-verified publisher   | Connector publishers are independently vetted    |
| Outbound network to non-major-cloud domains         | Data exfiltration risk                           |
| In-process hosting request (apps only)              | Direct DB access requires extra trust            |
| Largest tier (apps requesting > 10 capabilities)    | Outsize blast radius warrants extra eyes         |

Typical SLA: 3 business days for first review, 1 business day for re-review.

### Approval

Once approved:

- The listing goes live in the marketplace UI
- Verified-publisher badge applied
- Bundle is mirrored to the BoringOS CDN with its signature
- Shell registries update; tenants see the listing within minutes

---

## 5. The Install Pipeline (What the Shell Does Internally)

Same pipeline regardless of distribution path. Steps:

```
User clicks Install
    │
    ▼
1. Fetch manifest + bundle (from GitHub or marketplace CDN)
    │
    ▼
2. Verify signature (marketplace) OR compute hash (GitHub direct)
    │
    ▼
3. Validate manifest against current shell version (minRuntime, kind)
    │
    ▼
4. Resolve dependencies (other apps required, connectors used)
    │  → if missing, surface install-together prompt
    │
    ▼
5. Show permission prompt
    │  → user can drop individual capabilities (some may block install)
    │
    ▼
6. User approves
    │
    ▼
7. Begin install transaction:
    a. Create install record in tenant_apps / tenant_connectors
    b. Run schema migrations (apps only) inside DB transaction
    c. Mount routes (apps only)
    d. Register agents, workflows, context providers (apps only)
    e. Register OAuth flow / webhook handlers (connectors)
    f. Lazy-load UI bundle, register slot contributions (apps only)
    g. Execute onTenantCreated hook (apps only)
    │
    ▼
8. Commit transaction; emit `app.installed` event
    │
    ▼
9. Apps screen updates; nav entries appear; copilot picks up new agentDocs
```

Step 7 is atomic. Any failure rolls everything back — no half-installed apps.

---

## 6. Updates

### Update detection

- Shell polls the registry (marketplace + tracked GitHub releases) every 6 hours
- On finding a newer version that satisfies the user's update channel (stable / beta), surfaces a notification

### Update channels

- **Auto-patch:** patch versions install automatically (default for marketplace apps with verified publishers)
- **Manual:** user approves every update (default for GitHub-direct installs)
- **Locked:** user pins a specific version; updates suppressed until unlocked

### What requires re-consent

| Update type | User sees                                        |
| ----------- | ------------------------------------------------ |
| Patch       | Silent install (or notification if channel = manual) |
| Minor       | Notification with changelog; one-click approve   |
| Major       | Permission re-prompt with full capability diff   |

The diff highlights newly requested capabilities in red, removed capabilities in green. Users can decline a major upgrade and stay on the prior version until forced sunset.

### Failed updates

If a major update's migrations fail mid-transaction, the install rolls back to the prior version. The user is shown the error; the publisher is notified. The app stays usable.

---

## 7. Signed Bundles

Marketplace bundles are signed; GitHub-direct bundles are not.

### Publisher keys

When you first run `npx businessos publish`, the CLI generates a publisher keypair and registers the public key with the marketplace. The private key stays on your machine (or in your CI secret store).

Every subsequent publish signs the bundle hash with this key.

### What signing prevents

- Tampering: a modified bundle won't verify against the original signature
- Spoofing: only the holder of the private key can publish updates under your publisher identity
- Trust spread: the verified-publisher badge tells users they're getting code from the same source as the original install

### Key rotation

Publishers can rotate keys via the dev portal; old signatures remain valid for already-installed bundles, new publishes use the new key.

### What signing does not do

Signing is identity, not safety. A signed bundle from a malicious-but-verified publisher is still malicious. Capability declarations + automated review + human review + sandboxing are what enforce safety. Signing is one layer.

---

## 8. Uninstall

Available from the Apps screen. Two modes:

| Mode             | What happens                                                         |
| ---------------- | -------------------------------------------------------------------- |
| **Soft uninstall** (default) | Routes unmount, agents pause, UI slots unregister. Data retained 30 days; reinstall during retention window restores everything. |
| **Hard uninstall** | Soft steps + immediate drop of namespaced tables, deletion of file storage, removal of agents. Irreversible. |

The default 30-day soft retention is shell-controlled; tenants can configure shorter or longer windows in Settings.

### Cascading

If app A is uninstalled and app B has a declared dependency on A's entities, the user is warned: "Uninstalling CRM will disable Accounts' invoice generation. Continue?" They can proceed (B is paused) or cancel.

---

## 9. Discovery & Marketplace UX

The marketplace has two views in the shell's Apps screen:

- **Browse:** category-organized listings (CRM, Accounts, HR, Sales, Finance, Productivity, ...) with filters (publisher, price, install count, rating)
- **Updates:** apps with available updates, grouped by channel

Each listing surfaces:

- Publisher (with verified badge)
- Version + release date
- Install count + average rating
- Capabilities at a glance (icons, full list on click)
- Screenshots, longer description, changelog
- Pricing tier (free / paid / freemium)
- Source link (GitHub, if open source)

---

## 10. Pricing & Billing (Future)

Reserved for the marketplace's economic layer. Out of scope for v1, but the manifest reserves a `pricing` field:

```json
"pricing": {
  "model": "per-seat",
  "price": 1500,            // cents/seat/month
  "trialDays": 14
}
```

When billing rails ship, the shell will collect payment at install for paid apps and meter usage for usage-priced apps. Revenue share follows the Shopify model (30% → 15% at scale).

---

## 11. Reading Order From Here

- [Building Connectors](./building-connectors.md) — the connector-specific surface
- [Building Apps](./building-apps.md) — the app-specific surface
- [Capabilities](../capabilities.md) — the full capability scope catalog
- [App SDK Reference](../app-sdk.md) — type definitions for everything referenced here

---

*Last updated: 2026-04-30*

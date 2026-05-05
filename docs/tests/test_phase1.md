# Phase 1 — Manual Test Plan

> Run this before declaring Phase 1 truly done, and again before any Phase 2 work touches the same surfaces. Each step has a pass/fail criterion. Estimated total time: ~45 minutes for the full plan; ~10 minutes for a smoke pass (Steps 1, 2, 5).

**Branch under test:** `feat_business_shell` of `boringos-framework`, and `feat_business_shell` of `boringos-crm` (latter not yet pushed at time of writing).

**Scope:** everything Phase 1 built across workstreams B (App SDK), D (Connector migration), A (Shell extraction), C (Apps lifecycle), E (Default apps).

---

## Pre-flight

### Step 0 — Working tree state

```
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
git checkout feat_business_shell
git pull --ff-only
git status
```

**Pass when:** working tree is clean and you're on `feat_business_shell`.

### Step 0.1 — Install dependencies

```
pnpm install
```

**Pass when:** completes without ERR. Peer warning about `react-dom 19.2.5` vs `react 19.2.4` is pre-existing and ignorable.

### Step 0.2 — Build all packages

```
pnpm -r build
```

**Pass when:** every package compiles. `@boringos/app-sdk`, `@boringos/connector-sdk`, `@boringos/shell`, `@boringos/control-plane`, `@boringos-apps/generic-triage`, `@boringos-apps/generic-replier`, every `@boringos/connector-*` and the kernel packages should all show "build complete" or no output (silence = success for `tsc`).

**Common failures + fixes:**
- "tsbuildinfo stale" → `find packages -name tsconfig.tsbuildinfo -delete` then re-build
- "Cannot find module @boringos/app-sdk" → run `pnpm -F @boringos/app-sdk build` first

---

## Step 1 — Unit test suite (full)

```
pnpm test:run
```

**Pass when:** the only failing tests are `phase3-golden.test.ts` and `phase20-sync-handlers.test.ts > creates inbox items from array`. Both are pre-existing Postgres `CONNECTION_ENDED` flakes documented at D1; they predate Phase 1.

**What you should see (counts as of Phase 1 close):**

```
≥ 195 tests passed
2 tests failed (the two Postgres flakes above)
≥ 25 test files
```

**Files Phase 1 added that must pass:**
- `tests/manifest-validate.test.ts` (15)
- `tests/shell-slot-registry.test.ts` (11)
- `tests/shell-install-runtime.test.ts` (10)
- `tests/control-plane-fetcher.test.ts` (15)
- `tests/control-plane-validator.test.ts` (12)
- `tests/control-plane-install.test.ts` (10)
- `tests/control-plane-uninstall.test.ts` (7)
- `tests/control-plane-default-apps.test.ts` (5)
- `tests/shell-permission-prompt.test.ts` (7)

**Total Phase 1 tests:** 92.

If any of those files has a failure, stop and triage — that's a real Phase 1 regression.

---

## Step 2 — Connector CI verification

```
pnpm verify:connectors
```

**Pass when:** output ends with `Summary: 2/2 passed, 0/2 failed`. Each connector (Slack, Google) shows seven green check marks: schema validity, referenced files, event types, action names, OAuth scopes, action count, network honesty.

**Negative test (optional):** corrupt the Slack manifest's action count and re-run; verify the script exits non-zero with actionable per-line errors. Restore via `git checkout packages/@boringos/connector-slack/boringos.json`.

---

## Step 3 — Shell SPA visual smoke test

### Step 3.1 — Boot Vite

```
pnpm -F @boringos/shell dev
```

**Pass when:** Vite reports `ready in <time>` on port 5174 (or the next available port if 5174 is taken).

### Step 3.2 — Open the app

Navigate to `http://localhost:5174/` in a browser.

**Pass when:** you land on `/login` (because no session). The login screen shows:
- "BoringOS" centered title
- Email + password fields
- "Sign up" link below the button

### Step 3.3 — Navigate every screen via direct URL

Without auth (since the framework server may not be running), you'll be redirected to `/login` for each. That's the correct behavior. To test the chrome itself, see Step 4 (sign up against framework) or Step 3.4 (mock auth).

### Step 3.4 — Mock-auth chrome smoke test (optional)

In the browser DevTools console:

```js
localStorage.setItem("boringos.token", "mock-token");
localStorage.setItem("boringos.tenantId", "mock-tenant");
location.href = "/home";
```

The shell will attempt `GET /api/auth/me` and get 401, then bounce to `/login`. **This is correct behavior** — you can't fake an authenticated session without the framework server. To see the chrome, do Step 4.

---

## Step 4 — Auth + admin API end-to-end

This requires the framework server. Open a second terminal:

```
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
pnpm dev
```

(This boots `@boringos/server` on port 3000, embedded Postgres, all framework services.)

**Pass when:** the dev script logs "ready" or equivalent and the embedded Postgres comes up on a port like 5432 / 5596 (random-allocated).

### Step 4.1 — Sign up via the shell

In the shell (port 5174), navigate to `/signup`. Fill in:
- Name: `Test User`
- Email: `test+phase1@example.com`
- Password: `password123`
- Tenant name: `Phase 1 Test`

Click **Create tenant**.

**Pass when:**
- Browser navigates to `/home`
- Sidebar shows tenant name "Phase 1 Test" in the header
- Sidebar shows user card at the bottom: "Test User" + email
- 4 stat tiles render on Home (Open tasks: 0, Active agents: 1 — the auto-seeded copilot, Unread inbox: 0, Pending approvals: 0)
- "From your apps" section shows "No app widgets yet" empty state (no apps installed)

### Step 4.2 — Click through every sidebar entry

Visit each in turn:

| Screen | Pass when |
|---|---|
| Home | 4 stat tiles + empty-state widget area |
| Copilot | "Conversation UI lands in a follow-up" placeholder + "No tools yet" empty state |
| Inbox | Status filter (unread/read/snoozed/archived); empty state "No unread items" |
| Tasks | Status filter (all/todo/in_progress/blocked/done); empty state "No tasks yet" |
| Approvals (placeholder) | "Placeholder screen — landed in a later A-task" |
| Agents | One agent listed: "Copilot" (the auto-seeded one) |
| Workflows | Either empty state or framework's seeded workflows |
| Drive (placeholder) | placeholder screen |
| Connectors (placeholder) | placeholder screen |
| Apps | **Browse tab** shows 4 listings (CRM, Generic Triage, Generic Replier, Accounts), all with "Install" disabled and tooltip "Install lands in C5 (install pipeline)". **Installed tab** shows "No apps installed". **Updates tab** placeholder. **Install from URL tab** has the input field. |
| Activity (placeholder) | placeholder screen |
| Team (placeholder) | placeholder screen |
| Settings | Three tabs in left rail: General, Branding, (no app panels). General shows tenant name + role + email. |

### Step 4.3 — Test the Branding panel (TASK-A9)

Settings → Branding tab. As the admin user, you should see editable fields. Try:

1. Change "Product name" to `Acme Phase 1` → click **Save**
2. **Pass when:** the sidebar header text changes from "Phase 1 Test" (tenant name) to still showing the tenant name (the brand only changes the *fallback*, since user has tenantName). Verify "Saved <time>" appears.
3. Click **Reset to BoringOS defaults** → fields revert to placeholder values.

### Step 4.4 — Test the Apps screen Install-from-URL flow (manual fetch)

Settings → Apps → Install from URL. Paste:

```
github.com/parag/some-fake-test-repo
```

Click **Fetch**.

**Pass when:** an error message appears explaining the manifest could not be fetched (404 from raw.githubusercontent.com). This proves the fetcher (C3) is wired and surfaces errors cleanly.

For a positive test, point at a **real** repo with a `boringos.json` at the root — none exist publicly yet, so this is an inherently negative test in v1.

---

## Step 5 — Manifest validation (offline)

```
node --input-type=module -e "
const { validateManifest } = await import('./packages/@boringos/app-sdk/dist/index.js');
import { readFileSync } from 'node:fs';
const apps = ['generic-triage', 'generic-replier'];
for (const app of apps) {
  const m = JSON.parse(readFileSync(\`./apps/\${app}/boringos.json\`, 'utf-8'));
  const r = validateManifest(m);
  console.log(\`\${app}: \${r.valid ? 'valid' : 'INVALID'}\`);
  if (!r.valid) for (const e of r.errors) console.log(' -', e.message);
}
"
```

**Pass when:** both apps print `valid`. This verifies that the published default-app manifests still pass the D1 schema after any incidental edits.

---

## Step 6 — Install pipeline pure-function test

```
pnpm test:run tests/control-plane-install.test.ts tests/control-plane-uninstall.test.ts tests/control-plane-default-apps.test.ts
```

**Pass when:** 22/22 pass (10 + 7 + 5).

This exercises C5, C6, and E3 with mocked `db` / `slotRuntime` / `events`. The real Drizzle wiring is Phase 2's K-workstream — see "What does NOT work end-to-end yet" below.

---

## Step 7 — Branding precedence + reset (regression)

The brand defaults file lives at `packages/@boringos/shell/src/branding/defaults.ts`. Sanity-check:

```
grep "BoringOS" packages/@boringos/shell/src/branding/defaults.ts
```

**Pass when:** the productName default is `"BoringOS"` and the emailFromName default is `"BoringOS"`.

Then verify the sidebar's brand chrome:

```
grep "useBrand\|brand\." packages/@boringos/shell/src/chrome/Sidebar.tsx | head -10
```

**Pass when:** Sidebar reads `brand.logoUrl`, `brand.productName`, `brand.productTagline`, `brand.primaryColor` — none hardcoded.

---

## Step 8 — Connector schemas referenced exist on disk

```
node scripts/verify-connectors.mjs
```

(Same as Step 2; re-running here as the canonical "all referenced files exist" check.)

**Pass when:** Slack: 7 referenced files; Google: 19 referenced files; "all present" reported for both.

---

## What does NOT work end-to-end yet (by design)

These are the planned Phase 2 work items. **They're not bugs in Phase 1; they're the next phase's tasks.**

| Surface | Phase 1 state | What's missing | When it lands |
|---|---|---|---|
| **Apps screen "Install"** button (Browse tab) | Disabled | Wired to C5's pipeline via an admin API endpoint. C5 itself is a pure function with mocked deps; needs the kernel adapter. | Phase 2 Workstream K |
| **Default apps pre-installed at signup** | Catalog loop tested with mocks | The kernel's `onTenantCreated` doesn't yet call `installDefaultApps()`. `DEFAULT_APPS_CATALOG` is empty. | Phase 2 K8 + K9 |
| **CRM running inside the shell** | CRM still ships as a standalone SPA + server | CRM port: manifest, defineApp, slot contributions | Phase 2 Workstream L |
| **Permission prompt → actual install** | Renders correctly; Approve currently logs a warning | The shell's Apps screen needs to call the new install endpoint. | Phase 2 K10 |
| **CommandBar Cmd+K invokes a command** | Typeahead renders; invoke logs warning | Same as install — needs runtime ActionContext from the kernel adapter. | Phase 2 K6 |
| **Schema migrations + agent registration during install** | TODO comments in C5's source | Kernel adapter that reads manifest.schema, runs DDL inside the install txn, writes to `agents` table | Phase 2 K2 + K3 |

---

## Known pre-existing issues (NOT Phase 1 regressions)

- `tests/phase3-golden.test.ts` and `tests/phase20-sync-handlers.test.ts > creates inbox items from array` — embedded Postgres `CONNECTION_ENDED` flakes that predate Phase 1.
- `boringos-crm`'s standalone `pnpm typecheck` reports 7 errors, all in files Phase 1 didn't touch (stale `link:` to `@boringos/workflow-ui` from the framework rename + a few implicit-any in CRM-side workflow code). Tracked for Phase 2 cleanup.

---

## Smoke-pass shortlist (10 minutes)

For the abbreviated check before each Phase 2 task lands:

```
git checkout feat_business_shell && git pull --ff-only
pnpm install
pnpm -r build
pnpm test:run tests/manifest-validate.test.ts \
              tests/shell-slot-registry.test.ts \
              tests/shell-install-runtime.test.ts \
              tests/control-plane-fetcher.test.ts \
              tests/control-plane-validator.test.ts \
              tests/control-plane-install.test.ts \
              tests/control-plane-uninstall.test.ts \
              tests/control-plane-default-apps.test.ts \
              tests/shell-permission-prompt.test.ts
pnpm verify:connectors
```

If all of those are green, Phase 1 is in good shape and Phase 2 can land its next task.

---

*Last updated: 2026-05-05*

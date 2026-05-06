# Phase 3 — Workstream N + end-to-end manual test plan

> Manual user-facing test plan covering everything that's been built up to and including Phase 3 Workstream N (Connectors UI). Walks the full first-run user journey: sign-up → connect Gmail → first email triage → install CRM → CRM email-lens enrichment → Cmd+K → Copilot → uninstall.
>
> Estimated time for the full pass: **~60 minutes** (excluding GCloud setup).
> For a 10-minute smoke pass, do steps 0, 1, 2, 4 only.

**Branches under test:**
- `boringos-framework` → `feat_business_shell` at `b571223` or later
- `boringos-crm` → `main` at `cb8d824` or later

---

## Step 0 — Pre-flight (~5 min, ~20 min if first time)

### 0.1. Working tree state

```
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
git checkout feat_business_shell
git pull --ff-only
git status                    # should be clean
git log -1 --oneline          # should show b571223 (or later N-related commit)
```

**Pass when:** working tree clean, on `feat_business_shell`.

### 0.2. Install + build

```
pnpm install
pnpm -r build
```

**Pass when:** `pnpm -r build` finishes with no `Cannot find module` errors. Shell production bundle is ~495 KB.

### 0.3. (First time only) GCloud OAuth client

If you haven't already created a Google OAuth client:

1. Go to https://console.cloud.google.com/projectcreate, name it `hebbs-dev` (or anything).
2. Enable APIs at https://console.cloud.google.com/apis/library:
   - **Gmail API**
   - **Google Calendar API**
3. OAuth consent screen at https://console.cloud.google.com/apis/credentials/consent:
   - User type: **External**
   - App name: `Hebbs Dev`, support + dev email = your Gmail
   - Add yourself as a Test User (while in Testing mode)
   - Add scopes:
     - `.../auth/gmail.modify`
     - `.../auth/gmail.send`
     - `.../auth/calendar`
     - `.../auth/calendar.events`
4. Create OAuth 2.0 Client ID at https://console.cloud.google.com/apis/credentials:
   - Type: **Web application**
   - Authorized redirect URI: **`http://localhost:3030/api/connectors/oauth/google/callback`**
   - Save the **Client ID** and **Client secret** — you'll paste them below.

**Pass when:** you have both values copy-paste-ready.

### 0.4. Wire the Google credentials into the dev server

Edit `scripts/dev-server.mjs` (or set env vars; pick one):

```js
// scripts/dev-server.mjs
import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const app = new BoringOS({
  database: { embedded: true, port: pgPort },
  shellOrigin: "http://localhost:5174",      // or 5175 if 5174 is in use
});

// Register Google with your real OAuth client
app.connector(google({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
}));

const server = await app.listen(port);
console.log(`[dev-server] listening at ${server.url}`);
```

Then either set the env vars in your shell:

```bash
export GOOGLE_CLIENT_ID="123456789-abc.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

or hardcode them in the script (do NOT commit).

**Pass when:** `pnpm dev` boots without errors. If you see `clientId is missing` later when clicking Add → Google, the env vars didn't load.

---

## Step 1 — Boot both servers (~1 min)

In one terminal:

```
cd /Users/paragarora/Documents/Workspace/research/hebbs-clients/boringos-framework
pnpm dev
```

Wait for: `[dev-server] BoringOS listening at http://localhost:3030`

In a second terminal:

```
pnpm -F @boringos/shell dev
```

Wait for: `Local: http://localhost:5174/` (or 5175 if 5174 is taken).

**Pass when:**
- `curl http://localhost:3030/health` returns `{"status":"ok",...}`
- `curl http://localhost:5174/api/auth/me` returns `401 {"error":"Not authenticated"}` (this proves the Vite proxy is reaching the framework correctly).

---

## Step 2 — Sign up + default-app auto-install (~3 min)

### 2.1. Sign up

Open **http://localhost:5174/** (or :5175). You'll land on `/login`.

Click **Sign up**. Fill in:
- **Name:** `Test User`
- **Email:** `test+phase3@example.com`
- **Password:** `password123`
- **Tenant name:** `Phase 3 Test`

Click **Create tenant**.

**Pass when:**
- Browser navigates to `/home`
- Sidebar header reads **`Phase 3 Test`**
- Sidebar footer card reads **`Test User`** + email
- Home shows 4 stat tiles: Open tasks 0 · Active agents 1 · Unread inbox 0 · Pending approvals 0
- "From your apps" empty state visible

### 2.2. Verify default apps auto-installed (Phase 2 K9)

Click sidebar → **Apps** → **Installed** tab.

**Pass when:** you see at least 2 entries:
- `generic-triage`
- `generic-replier`

(If `Installed` shows "No apps installed", auto-provisioning is broken. Stop and check framework logs.)

### 2.3. SQL spot-check (optional but useful)

In a third terminal:

```bash
psql postgres://boringos:boringos@127.0.0.1:5436/boringos
```

```sql
select name, slug from tenants;
select id, app_id, status, version from tenant_apps;
select name, status from agents where tenant_id = (select id from tenants limit 1);
\q
```

**Pass when:** 1 tenant, 2+ tenant_apps rows (`status='installed'`), 3+ agents (copilot + the 2 default-app agents).

---

## Step 3 — Click through every sidebar entry (~5 min)

Each entry should at minimum render without console errors. Many are real now; a few are still placeholders pending Workstream S.

| Sidebar entry | Expected result | Pass marker |
|---|---|---|
| **Home** | 4 stat tiles + empty widgets area | renders |
| **Copilot** | Placeholder "Conversation UI lands in a follow-up" | placeholder text |
| **Inbox** | Status filter; "No unread items" empty state | filter present |
| **Tasks** | Status filter; "No tasks yet" empty state | filter present |
| **Approvals** | Placeholder | placeholder text |
| **Agents** | List with `Copilot` + 2+ default-app agents | ≥3 rows |
| **Workflows** | Either empty or seeded workflows | renders |
| **Drive** | Placeholder | placeholder text |
| **Connectors** | **Real screen** — list of connector kinds with Add buttons | see Step 4 |
| **Apps** | Browse/Installed/Updates/Install-from-URL tabs | tabs render |
| **Activity** | Placeholder | placeholder text |
| **Team** | Placeholder | placeholder text |
| **Settings** | General + Branding tabs | tabs render |

**Open DevTools → Console.** Watch for any red errors as you navigate. The React 19 version-mismatch error has been fixed; if you see it again, restart Vite (`pnpm -F @boringos/shell dev`) to clear the dep cache.

---

## Step 4 — Connectors screen + OAuth round-trip (~5 min) — N1–N7

### 4.1. Connectors page renders (N1)

Click **Connectors** in the sidebar.

**Pass when:**
- Page title: "Connectors"
- Subtitle: "OAuth into Gmail, Slack, and other services"
- One or two cards visible (depending on which connectors are registered in dev-server.mjs):
  - **Google** — "Gmail and Google Calendar integration" — status badge `Not connected` — `Add` button enabled
  - (If Slack registered) **Slack** — similar

If the page is empty, the framework didn't register any connectors. Check `dev-server.mjs` includes `app.connector(google({...}))`.

### 4.2. Click Add → wizard modal (N4)

Click **Add** on the Google card.

**Pass when:** A modal appears with:
- Title: "Connect Google Workspace"
- "You'll be granting access to" section listing scopes:
  - `gmail.modify`
  - `gmail.send`
  - `calendar`
  - `calendar.events`
- Cancel and Authorize buttons

Click **Cancel** → modal closes, no DB write.

### 4.3. OAuth round-trip (N2/N3) — real Google account

Click **Add** → **Authorize**.

Browser navigates to Google. Sign in with the test-user Gmail you added to the consent screen. Click "Allow".

Browser redirects back to `http://localhost:5174/connectors?connect=success&kind=google`.

**Pass when:**
- Green banner appears: "Connected Google. Sync workflows are now running on your behalf."
- The Google card now shows status `Connected`, with a `Disconnect` button instead of `Add`
- The `?connect=success&kind=google` querystring is removed from the URL

**SQL spot-check:**

```sql
select kind, status, created_at,
       (credentials->>'accessToken' is not null) as has_token,
       (credentials->>'refreshToken' is not null) as has_refresh
  from connectors;
```

Should show 1 row, `kind='google'`, `status='active'`, `has_token=true`, `has_refresh=true`.

### 4.4. Default sync workflow installed (N5)

```sql
select name, type, status from workflows where tenant_id = (select id from tenants limit 1);
select title, cron_expression, status from routines where tenant_id = (select id from tenants limit 1);
```

**Pass when:** 1 workflow with name `[connector-default:google.gmail-sync] Gmail sync` (status `active`), and 1 routine with `cron_expression='*/15 * * * *'` (status `active`).

### 4.5. First Gmail sync — wait or trigger manually

Either:
- **Wait** up to 15 minutes for the cron to fire, OR
- **Trigger manually** via curl:

```bash
SESSION=<your bearer token from localStorage 'boringos.token'>
TENANT=<your tenant id from localStorage 'boringos.tenantId'>

curl -X POST "http://localhost:3030/api/admin/workflows/<workflow-id>/run" \
  -H "Authorization: Bearer $SESSION" \
  -H "X-Tenant-Id: $TENANT"
```

(Workflow run endpoint may have a different path — if 404, check the framework logs for the actual route, or use the Workflows screen's "Run now" button if present.)

### 4.6. Send yourself an email + verify it lands

From a different account, send the test Gmail account an email:
- **Subject:** `Phase 3 test lead`
- **Body:** `I want to buy your product, $50K budget`

Wait ~60 seconds for the next sync (or trigger again).

Click sidebar → **Inbox**.

**Pass when:** the email appears in the inbox list with subject "Phase 3 test lead" and `from` = the sending address.

### 4.7. Verify generic-triage classified it

Click into the inbox item.

**Pass when:** the item's metadata panel (or the SQL row's `metadata` JSON) shows:
- `triage.classification: "lead"`
- `triage.score: 60–90`
- `triage.rationale: "<short sentence>"`

**SQL fallback** if the UI doesn't render metadata yet (Inbox detail is Workstream S):

```sql
select id, subject, status, metadata
  from inbox_items
  order by created_at desc limit 1;
```

The `metadata` JSON should contain a `triage` object.

### 4.8. Verify generic-replier drafted a reply

The `metadata` JSON should also contain a `replyDrafts` array (from generic-replier running in parallel on the same `inbox.item_created` event).

**Pass when:** both `triage` and `replyDrafts` are present — proves the Phase 1 layered-inbox model works end-to-end with real Gmail.

---

## Step 5 — Install CRM via Apps (~5 min)

### 5.1. Browse the Apps catalog

Sidebar → **Apps** → **Browse** tab.

**Pass when:** at least one card visible. CRM should be listed (manifest URL pointing at `boringos-crm` repo's `boringos.json`).

### 5.2. Install CRM

Click **Install** on the CRM card.

A permission prompt appears showing CRM's declared capabilities (Phase 1 C7 + Phase 2 K10).

Click **Approve**.

**Pass when (within ~30s — Phase 2 M1 gate):**
- Toast or inline message: "Installed"
- **Sidebar grows**: Pipeline, Deals, Contacts, Companies, (possibly Activities) appear as new nav entries
- Apps → Installed tab now shows CRM alongside the 2 default apps

### 5.3. SQL verification

```sql
-- New CRM tables
\dt crm_*

-- New agents (CRM seeds 5)
select name, role from agents
  where tenant_id = (select id from tenants limit 1)
  order by created_at desc limit 7;

-- Default pipeline + 7 stages (Phase 2 M3)
select name from crm_pipelines;
select name from crm_pipeline_stages;
```

**Pass when:**
- Tables `crm_deals`, `crm_contacts`, `crm_companies` exist
- 5 new agents added (Pipeline Coach, Deal Researcher, etc.)
- 1 default pipeline + 7 stages

### 5.4. Re-visit the inbox item — CRM email-lens enrichment (Phase 2 L10)

Go back to Inbox → click the email from Step 4.6.

**Pass when:** the metadata now ALSO contains a `crm.lens` object (CRM's email-lens agent ran on `triage.classified` and added enrichment WITHOUT overwriting the triage classification).

**SQL:**

```sql
select metadata from inbox_items where id = '<the-email-id>';
```

The JSON should contain BOTH `triage` (from generic-triage) AND `crm.lens` (from CRM's email-lens). If `crm.lens` clobbered `triage`, that's a regression.

---

## Step 6 — Exercise CRM end to end (~10 min)

| Surface | Action | Pass when |
|---|---|---|
| **Pipeline** | Click "+ Add deal", fill form | Deal appears as a card on the first stage |
| Pipeline | Drag the new deal to the next stage | Optimistic update; persists after refresh |
| **Deals** | Click into a deal | Detail page renders; EntityActions toolbar visible |
| Deal detail | Click an EntityAction (e.g., "Send follow-up") | Action invokes (logs may show wake of an agent) |
| **Contacts** | Search by email or name | Filter applies; matching rows shown |
| Contact detail | Open one | Linked deals visible |
| **Companies** | Click into one | Linked deals + contacts visible |
| **Settings → CRM** | Edit a pipeline stage name | Save persists; pipeline view reflects |

---

## Step 7 — Cmd+K command bar (~2 min) — Phase 2 K6 ActionContext

Press **Cmd+K** anywhere.

**Pass when:**
- A command palette overlay opens
- Typing a few characters surfaces matching commands from installed apps (e.g., from CRM)
- Selecting a command runs it (no longer logs a warning — it actually invokes the action)

If you see `[shell] command runtime not yet wired` in the console, K6 didn't make it; check Phase 2 status.

---

## Step 8 — Copilot conversation (~3 min)

Sidebar → **Copilot**.

The screen still says "Conversation UI lands in a follow-up" until Workstream S1 ships. Until then, use the API directly:

```bash
SESSION=<bearer>
TENANT=<tenant-id>

# Create a copilot session
curl -s -X POST http://localhost:3030/api/copilot/sessions \
  -H "Authorization: Bearer $SESSION" -H "X-Tenant-Id: $TENANT"

# Send a message (replace SESSION_ID with the id returned above)
curl -s -X POST http://localhost:3030/api/copilot/sessions/SESSION_ID/message \
  -H "Authorization: Bearer $SESSION" -H "X-Tenant-Id: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"content":"What deals are open in my pipeline?"}'
```

Wait ~30s for the agent to wake + respond.

**Pass when:** the message thread (fetched via `GET /api/copilot/sessions/SESSION_ID`) contains a comment from the copilot agent that references actual CRM data — not "I don't know about CRM." This validates Phase 2 M4 (copilot agentDocs from CRM injected).

---

## Step 9 — Disconnect Gmail (~2 min) — N6

Sidebar → **Connectors** → click **Disconnect** on the Google card.

**Pass when:**
- Confirmation modal appears explaining: tokens removed, workflows paused, data preserved
- Click Disconnect → card flips back to "Not connected" state

**SQL:**

```sql
select count(*) from connectors;                             -- 0
select status from routines
  where description like '[connector-default:google.gmail-sync]%';   -- 'paused'
select count(*) from workflows
  where name like '[connector-default:google.gmail-sync]%';          -- 1 (still there)
```

### 9.1. Reconnect

Click **Add** → walk OAuth again. Google's consent screen may auto-approve since you already granted the scopes.

**Pass when:**
- Card returns to Connected
- The same routine row's status flips back to `'active'`
- No new workflow row created (the existing one was reused)

---

## Step 10 — Health indicator in chrome (~1 min) — N7

To trigger a degraded state, manually flip the connector status:

```sql
update connectors set status = 'expired'
  where kind = 'google' and tenant_id = (select id from tenants limit 1);
```

Wait up to 60s (the indicator polls every minute) or refresh the page.

**Pass when:**
- A small amber pill appears in the top-right of the main content area: "1 connector needs attention"
- Click it → flyout shows Google with status "Token expired" and a "Manage connectors →" link
- Click the link → routes to `/connectors`, where the Google card now has a `Reconnect` button

Reset:

```sql
update connectors set status = 'active' where kind = 'google';
```

The pill should disappear within 60s.

---

## Step 11 — Uninstall CRM (~3 min) — Phase 2 K11

Sidebar → **Apps** → **Installed** → CRM → click **Uninstall** → choose **Hard**.

A cascade-warning prompt appears. Confirm.

**Pass when:**
- Sidebar shrinks back (Pipeline, Deals, Contacts, Companies disappear)
- CRM tables dropped:
  ```sql
  \dt crm_*    -- should error or return nothing
  ```
- CRM agents removed:
  ```sql
  select count(*) from agents where role like 'crm.%';   -- 0
  ```
- `/api/crm/deals` returns 404

---

## Smoke pass (10 min) — abbreviated

For the abbreviated check between Phase 3 task landings:

1. **Step 0** — `git pull && pnpm install && pnpm -r build`
2. **Step 1** — boot both servers
3. **Step 2** — sign up, verify default apps installed
4. **Step 4.1–4.2** — Connectors page + Add modal scopes (no real OAuth)
5. **Step 5.1–5.2** — install CRM, sidebar grows

If those are green, the platform isn't broken; deeper test on demand.

---

## Known issues / gaps documented elsewhere

- **Inbox detail view (S8) not built yet** — metadata is in DB but the rich panel UI lands later in Workstream S
- **Approvals/Drive/Activity/Team UIs** — placeholders; Workstream S
- **Onboarding wizard** — not built yet; Workstream S
- **Copilot UI** — placeholder; Workstream S1
- **Notifications dropdown** — N7 covers connector health only; full notifications dropdown is S7

---

## React 19 version-mismatch fix (one-time)

If you see this error in the browser:

```
Uncaught Error: Incompatible React versions: react 19.2.4 vs react-dom 19.2.5
```

It was fixed via a workspace pnpm override at the root `package.json`:

```json
"pnpm": {
  "overrides": {
    "react": "19.2.4",
    "react-dom": "19.2.4"
  }
}
```

If you ever see it again after a `pnpm install`:

1. `rm -rf packages/@boringos/shell/node_modules/.vite` (clear Vite dep cache)
2. `pnpm install`
3. Restart shell Vite: `pnpm -F @boringos/shell dev`

---

## Decision-gate checklist

Before declaring this manual pass green, the following must all be true:

- [ ] Sign-up auto-installs generic-triage + generic-replier
- [ ] Connectors page lists registered connectors with correct status
- [ ] Add → modal → Google OAuth → callback → Connected (real Google account)
- [ ] Default Gmail sync workflow + cron routine installed on connect
- [ ] First inbox item arrives within 60s of next sync
- [ ] generic-triage AND generic-replier annotate the same item in parallel
- [ ] CRM installs in ≤ 30s; 5 agents seed; sidebar grows
- [ ] CRM email-lens enriches the existing inbox item without overwriting triage
- [ ] Disconnect pauses workflow; reconnect resumes (no duplicate rows)
- [ ] Health indicator surfaces expired status; routes to /connectors

---

*Last updated: 2026-05-06 — covers up to commit b571223 (Phase 3 N close).*

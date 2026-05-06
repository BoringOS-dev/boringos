# Test today — quick checklist

> Throwaway. Tick as you go. Open http://localhost:5175/ in browser. Hard-refresh first (Cmd+Shift+R) to clear cached bundle.

## URLs / creds

- Shell: **http://localhost:5175/**
- API: http://localhost:3030
- Postgres: `psql postgres://boringos:boringos@127.0.0.1:5436/boringos`

## Boot (only if not running)

- [ ] Terminal 1: `cd boringos-framework && pnpm dev` → wait for "BoringOS listening at :3030"
- [ ] Terminal 2: `pnpm -F @boringos/shell dev` → note the port (5174 or 5175)

## Sign up

- [ ] Open shell URL → lands on `/login`
- [ ] Click "Sign up"
- [ ] Email: `parag@hebbs.ai` / pwd: `password123` / tenant: `Test Today`
- [ ] Gmail OAuth in Step "Connectors" will use `parag@revelin7.com`
- [ ] Submit → lands on `/home`
- [ ] Sidebar shows tenant name + user

## Sidebar walkthrough

- [ ] Home → 4 stat tiles
- [ ] Copilot → placeholder
- [ ] Inbox → empty filter
- [ ] Tasks → empty filter
- [ ] Approvals → placeholder
- [ ] Agents → at least 3 rows (copilot + triage + replier)
- [ ] Workflows → list (may be empty)
- [ ] Drive → placeholder
- [ ] **Connectors** → real page (Step below)
- [ ] Apps → 4 tabs + Installed shows generic-triage + generic-replier
- [ ] Activity → placeholder
- [ ] Team → placeholder
- [ ] Settings → General + Branding tabs
- [ ] No red console errors on any screen

## Connectors + real Gmail (needs GCloud OAuth client)

GCloud setup if not done: console.cloud.google.com → enable Gmail + Calendar APIs → OAuth consent screen → add yourself as test user → create Web OAuth client with redirect `http://localhost:3030/api/connectors/oauth/google/callback` → copy client ID + secret.

Wire creds into `scripts/dev-server.mjs`:
```js
import { google } from "@boringos/connector-google";
app.connector(google({ clientId: "...", clientSecret: "..." }));
```
Restart `pnpm dev`.

- [ ] Sidebar → Connectors → Google card visible, status "Not connected"
- [ ] Click **Add** → modal shows scopes (gmail.modify, calendar, etc.)
- [ ] Click **Authorize** → browser goes to Google → grant → returns to `/connectors?connect=success`
- [ ] Green banner: "Connected Google. Sync workflows are now running…"
- [ ] Card now shows "Connected" + Disconnect button
- [ ] In psql: `select kind, status from connectors;` → 1 row, `active`
- [ ] In psql: `select name, status from workflows;` → row tagged `[connector-default:google.gmail-sync]`, status `active`
- [ ] Send yourself an email from another account, subject "Test today lead"
- [ ] Wait ≤15 min (or trigger workflow manually) → email shows up in Inbox
- [ ] Click into the inbox item → SQL: `select metadata from inbox_items order by created_at desc limit 1;` → contains `triage` + `replyDrafts`

## Install CRM via Apps

- [ ] Apps → Browse → click **Install** on CRM
- [ ] Permission prompt → click **Approve**
- [ ] ≤30s: sidebar grows with Pipeline / Deals / Contacts / Companies
- [ ] In psql: `\dt crm_*` → tables exist; `select count(*) from agents;` → +5 agents
- [ ] Inbox: re-open the email → metadata now contains `crm.lens` AND `triage` (lens didn't overwrite)

## Use CRM

- [ ] Pipeline → "+ Add deal" → fill form → deal appears
- [ ] Drag deal between stages → persists after refresh
- [ ] Click deal → detail page renders with EntityActions toolbar
- [ ] Contacts → search works
- [ ] Companies → click one → linked deals visible
- [ ] Settings → CRM panel → edit a stage name → saves

## Cmd+K

- [ ] Press Cmd+K anywhere
- [ ] Palette opens, typing surfaces commands
- [ ] Pick one → it runs (no console "not yet wired" warnings)

## Copilot (API only — UI is still placeholder)

- [ ] `curl -X POST http://localhost:3030/api/copilot/sessions -H "Authorization: Bearer <token>" -H "X-Tenant-Id: <tid>"` → returns session id
- [ ] POST a message: `{"content":"What deals are open?"}` to `/api/copilot/sessions/<id>/message`
- [ ] Wait 30s → GET the session → reply references actual CRM data

## Disconnect / reconnect Gmail

- [ ] Connectors → Google → **Disconnect** → confirmation modal → confirm
- [ ] Card flips to "Not connected"
- [ ] In psql: `select status from routines where description like '[connector-default:google.gmail-sync]%';` → `paused`
- [ ] Click **Add** → walk OAuth again → card returns to Connected
- [ ] In psql: routine status flips back to `active`; no new workflow row created

## Health indicator (N7)

- [ ] In psql: `update connectors set status='expired' where kind='google';`
- [ ] Within 60s: amber pill in top-right of main area: "1 connector needs attention"
- [ ] Click pill → flyout → click "Manage connectors →" → routes to Connectors
- [ ] Card now shows "Token expired" + Reconnect button
- [ ] In psql: `update connectors set status='active' where kind='google';` → pill disappears within 60s

## Uninstall CRM

- [ ] Apps → Installed → CRM → **Uninstall** → choose **Hard** → confirm
- [ ] Sidebar shrinks (Pipeline/Deals/Contacts/Companies gone)
- [ ] In psql: `\dt crm_*` → empty; `select count(*) from agents where role like 'crm.%';` → 0
- [ ] `/api/crm/deals` returns 404

## Done

If every box ticked → workstream N + everything before it works end-to-end. Delete this file or stash it.

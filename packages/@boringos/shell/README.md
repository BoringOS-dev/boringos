# @boringos/shell

> The BoringOS Shell — the user-facing OS surface (wp-admin equivalent).

The shell is what a user sees on day one, before any app is installed. It hosts apps, renders slot contributions, and ships with: Inbox, Copilot, Tasks, Workflows, Agents, Drive, Connectors, Apps, Team, Settings.

## Status

**`0.0.1` — TASK-A1 skeleton.** Boots a blank React app via Vite. Real chrome (Layout, Sidebar, CommandBar) lands in TASK-A3 after the slot type contracts (A2) and slot registry (A6).

The full Phase 1 sequence for the shell:

| Task | Goal |
|---|---|
| A1 | Package skeleton (this) |
| A2 | Slot type contracts |
| A3 | Lift Layout / Sidebar / CommandBar from CRM |
| A4 | Lift auth screens |
| A5 | Lift shared screens (Home, Copilot, Inbox, Tasks, Agents, Workflows, Settings) |
| A6 | Slot registration runtime |
| A7 | Apps screen (Browse / Installed / Install from URL) |
| A8 | Strip CRM web of moved code |
| A9 | BrandProvider + Settings → Branding panel |

## Local dev

```
pnpm -F @boringos/shell dev
```

Boots Vite on port 5174. Proxies `/api/*` to `localhost:3000` (where the BoringOS server runs).

## License

[BUSL-1.1](./LICENSE) — Business Source License 1.1, auto-converts to Apache 2.0 four years after each version's release. See the repo's [LICENSE.md](../../../LICENSE.md) for the full per-package matrix.

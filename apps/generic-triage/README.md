# Generic Inbox Triage

Pre-installed first-party app for [BoringOS](https://boringos.dev). Classifies inbox items, scores importance, and attaches metadata so domain apps (Generic Replier, CRM, etc.) can act on the result without re-classifying.

Built using only `@boringos/app-sdk` — same surface a third-party developer uses.

## What it does

Subscribes to `inbox.item_created`. Wakes the Triage agent. Agent classifies (`lead`/`reply`/`internal`/`newsletter`/`spam`), scores 0–100, writes to `item.metadata.triage`, emits `triage.classified`.

## What it doesn't do

- Draft replies (that's [Generic Replier](../generic-replier/))
- Create or modify CRM entities (that's CRM)

## Capabilities

```
events:subscribe:inbox.item_created
events:emit:triage.*
inbox:read
inbox:write
agents:register
workflows:register
memory:read
```

## License

[BUSL-1.1](./LICENSE) — see [`LICENSE.md`](../../LICENSE.md) at the repo root.

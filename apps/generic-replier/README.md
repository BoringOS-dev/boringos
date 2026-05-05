# Generic Email Replier

Pre-installed first-party app for [BoringOS](https://boringos.dev). Drafts a polite, neutral reply suggestion for every incoming inbox item that's not a newsletter or spam. **Appends** to the item's suggestions list — never overwrites, never sends.

Built using only `@boringos/app-sdk`.

## What it does

Subscribes to `inbox.item_created`. Wakes the Replier agent. Agent reads the item, skips newsletters/spam, drafts ≤4-sentence reply, appends `{ source, draft, draftedAt }` to `item.metadata.suggestedReplies`, emits `replier.draft_appended`.

## Coexistence

Multiple apps can append to the same suggestions list. The user sees all of them and picks which to send. CRM might also draft a CRM-aware reply for the same email; both appear, both are valid.

## Capabilities

```
events:subscribe:inbox.item_created
events:emit:replier.draft_appended
inbox:read
inbox:write
agents:register
workflows:register
```

## License

[BUSL-1.1](./LICENSE) — see [`LICENSE.md`](../../LICENSE.md) at the repo root.

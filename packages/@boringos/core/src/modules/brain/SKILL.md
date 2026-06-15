# Brain — your company's foundation brain

The brain is one Postgres-backed store over your books, your relationships,
and your memory. It has four retrieval tiers and one synthesis verb. You
reach it through the `brain.*` tools — and so can external AI tools, over MCP.

## The verbs

| Tool | Use it when |
|---|---|
| `brain.ask` | You want **the answer**, cited, with an honest account of what the brain doesn't know. Spawns a synthesis run — slower, but it reasons across every tier. |
| `brain.search` | You want grounded chunks fast (hybrid semantic + keyword). No synthesis. |
| `brain.query` | The question is **exact** — a number, a count, a date. Read-only SQL over the live operational + module tables. Numbers never go through a vector. |
| `brain.graph` | The question is about **relationships** — who works where, which deals touch which invoices. Typed multi-hop traversal. |
| `brain.remember` | Save a durable fact. Writes the canonical file AND indexes it. |
| `brain.forget` | Soft-delete a memory you wrote. |

## Routing — pick the right tier

- **"What did we spend on Meta in May?"** → `brain.query` (exact SQL, auditable to the cent). NEVER answer a money/metric question from semantic search.
- **"What did we decide about pricing?"** → `brain.search` or `brain.ask` (prose lives in the semantic tier).
- **"Who at Acme do we know, and which deals?"** → `brain.graph` (relationships).
- **Open-ended, spans tiers** → `brain.ask` (it orchestrates the others for you).

## brain.query — exact answers

Read-only. The brain runs your SQL inside a read-only transaction with a
statement timeout — writes and DDL are rejected by Postgres, not by parsing
your query. The operational core is already structured data you can query
directly: `inbox_items` (emails), `task_comments`, `tasks`, `agent_runs`,
plus any module's `<module>__*` tables (e.g. `ledger__transactions`,
`crm__deals`). Always filter by `tenant_id` — the brain does not rewrite
your SQL to scope it.

## brain.ask — the synthesis contract

`brain.ask` returns a cited answer + a gap analysis. When YOU are the agent
answering a `brain.ask` synthesis task, you MUST:

1. **Route exact questions to `brain.query`.** A dollar figure or a count
   that came from a vector is a bug. Trace every number to a row.
2. **Cite every claim.** Each fact resolves to a `row`, `memory`, `file`,
   or `edge`. Prose cites a memory/file; numbers cite a row.
3. **State what you could not find.** "No ad-spend data after May 30." The
   gap analysis is the trust mechanism — never paper over a hole.
4. **Propose, don't commit.** If the answer implies an action (send, pay,
   delete, wake an agent), propose it as an `agent_action` task — don't
   execute it inside the answer.

## Memory tree — where facts live

Canonical files under `./drive/shared/memory/` (tenant) and
`./drive/users/<owner>/memory/` (you). Numbered folders = read priority:

```
MEMORY.md      index + pointers, <200 lines
10-domains/    canonical facts (each ends with "(src: …)")
20-decisions/  dated, who + why
30-people/  40-operations/
60-daily/YYYY-MM-DD.md   append-only landing zone (facts + run checkpoints)
70-weekly/  99-archive/
```

**Read order on wake:** preferences → your `MEMORY.md` → shared `MEMORY.md`
→ today's + yesterday's `60-daily/` → current `70-weekly/` → grep on demand.

**Write order:**
- A quick fact / observation → `memory.remember` (or `brain.remember`) —
  it appends to today's `60-daily/` note and the curator promotes it later.
- A standing rule / explicit "remember / from now on / always" → write it
  straight into `20-decisions/<topic>.md` + a one-line `MEMORY.md` pointer,
  **before responding**.
- Stable entity facts → `10-domains/<entity>.md`.

Read natively (`MEMORY.md`, then `grep`). Every write is mirrored into the
brain, and `[[wikilinks]]` auto-wire the entity graph with zero LLM calls —
so link entities you mention. One canonical home per fact; `MEMORY.md` holds
pointers, not warehouses; contradictions get a `CONFLICT:` block, not a
silent overwrite.

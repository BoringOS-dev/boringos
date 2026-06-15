# Memory

You have **persistent, file-based memory** at `./drive/` in your
workdir. Everything you write here survives the run. Read it on
every wake. Save deliberately, in small useful pieces, at the
right scope.

Your data lives at **two well-known paths**:

- `./drive/me/` — the current human you're working for (their
  preferences, decisions, notes). Always available when a human
  initiated the wake; absent on routine / cron wakes.
- `./drive/shared/` — tenant-wide canonical truth (org policy,
  customer/vendor facts every agent should converge on). Always
  available.

You do not need to know any user-id, tenant-id, or UUID. The
framework wires `./drive/me/` to whoever this run is for; you
just `cat`, `Read`, `Grep`, and `Write` against that path.

## How you read and write memory

**Use the filesystem.** `Read`, `Write`, `Edit`, `Grep`, `Glob`,
and `Bash` (`cat`, `find`, `rg`, `ls`) all work on `./drive/`
natively. This is the only path. Do NOT use `Bash` to `curl`
HTTP tools to "save" things — that defeats the entire memory
system. Same on-disk endpoint, no HTTP round-trip, composes
with shell pipelines.

## The cardinal rule

**When the user says "save", "remember", "note", "from now on",
"always", or any phrase that implies persistence — you MUST
`Write` a file at `./drive/me/memory/20-decisions/<topic>.md` (or
`./drive/shared/memory/...` for tenant-scope facts) BEFORE
responding.** Saying "Saved", "Remembered", or "I'll keep that
in mind" without an actual filesystem `Write` is a lie. If you
posted a comment, that's not a save — comments are per-task
transcript, not memory. Verify with `ls` after writing.

## Passive signals — capture without being asked

Users drop preferences, facts, and corrections **without using
the verbs above**. The cardinal rule fires on these passive
shapes too; treat them the same as an explicit "save":

| Shape | Example | Route to |
|---|---|---|
| Preference statement | *"I prefer terse responses"* · *"I'd rather see it as a table"* · *"next time, skip the preamble"* | `./drive/me/memory/20-decisions/<topic>.md` |
| Negative preference / hard rule | *"stop suggesting Calendly"* · *"don't auto-merge anymore"* · *"never use co-authors"* | `./drive/me/memory/20-decisions/<topic>.md` |
| Correction or alias | *"no, I meant Acme not Apex"* · *"actually her title is VP Eng, not Director"* | Update the relevant `10-domains/<entity>.md` and the matching bullet in `MEMORY.md` so future agents don't repeat the slip. |
| Stable fact about an entity, mentioned in passing | *"Acme renews October"* · *"John's the CFO over there"* · *"we always sign net-30 with vendors"* | `./drive/shared/memory/10-domains/<entity>.md` (tenant-wide truth) or `./drive/me/memory/10-domains/<entity>.md` (only this human cares). |
| Repeated pattern across a session | The user asks to "draft before sending" for the third time this session | Promote to `./drive/me/memory/20-decisions/draft-before-send.md`. Persistent friction is itself a signal. |

**If you noticed something worth keeping but you're not sure it
warrants a `20-decisions/` or `10-domains/` file yet**, drop a one-line
capture into `./drive/me/memory/60-daily/<YYYY-MM-DD>.md`
and move on. Notes are the cheap path — high recall, low cost.
A future synthesis pass promotes what matters. **A noisy
`60-daily/` is fine; a fact silently dropped on the floor is not.**

The discipline to internalize: **before you post your final reply,
re-scan the user's last message for any of the shapes above. If
one is present, write the file first, then reply.** A reply that
ends with "got it" while the user just established a standing
rule is a bug — you've thrown away their intent.

## Where memory lives

Same shape at both scopes. **Numeric prefixes = read priority** (lower
first). A quick capture lands in today's `60-daily/` note; durable truth
is promoted up into the numbered folders at synthesis.

```
./drive/me/
  preferences.md              ← human-edited; YOU read, don't write
  memory/
    MEMORY.md                 ← index + pointers, <200 lines — you maintain this
    10-domains/<entity>.md    ← stable facts about this human's world
    20-decisions/<topic>.md   ← standing rules this human has set (dated, who+why)
    40-operations/<how-to>.md ← learned procedures, runbooks
    60-daily/YYYY-MM-DD.md    ← append-only landing zone (captures + run checkpoints)
    70-weekly/YYYY-WW.md      ← weekly synthesis (written by the distillation pass)
    99-archive/               ← superseded detail, never deleted

./drive/shared/
  memory/
    MEMORY.md                 ← tenant-wide canonical truth (pointers)
    10-domains/<entity>.md    ← customer/vendor/company facts
    20-decisions/<topic>.md   ← org policies, naming conventions
    30-people/<person>.md     ← who does what, who to ask
    40-operations/  60-daily/  70-weekly/  99-archive/
```

## Read order on every wake

Run these reads at the start of every wake, in order:

```bash
cat ./drive/me/preferences.md                          # if ./drive/me exists
cat ./drive/me/memory/MEMORY.md                        # if ./drive/me exists
cat ./drive/shared/memory/MEMORY.md
# Today's + yesterday's daily notes (recent captures + run history):
cat ./drive/me/memory/60-daily/$(date -u +%F).md 2>/dev/null
cat ./drive/me/memory/60-daily/$(date -u -d yesterday +%F 2>/dev/null || date -u -v-1d +%F).md 2>/dev/null
# The current week's synthesis, if present:
cat ./drive/me/memory/70-weekly/*.md 2>/dev/null | tail -50
# The current work's log (task-bound runs keep a working log):
cat ./drive/tasks/<active>/log.md                      # if task-bound
# Then targeted searches when a topic surfaces:
grep -ri "<topic>" ./drive/me/memory/
grep -ri "<topic>" ./drive/shared/memory/
```

If `./drive/me/` doesn't exist, this wake has no human owner
(routine / cron / webhook). Skip the me-scope reads; operate on
`./drive/shared/` only.

## Curator pass — resolve drift before you work

After reading `shared/memory/MEMORY.md`, spot-check the entity files it
points to. You are the curator for the duration of this wake.

For each `10-domains/` or `20-decisions/` bullet in the index, open the
backing file and check whether the one-line summary in the bullet still
reflects the file's current state — especially:

- new `##` sections appended since the bullet was written (e.g.
  `## Activity`, `## Enrichment`, `## Stakeholders`),
- facts that contradict or supersede the bullet's summary.

If the bullet is stale, **update it in-place before you start your
task**. Do not leave drift for the next agent to inherit.

```bash
# Example: shared MEMORY.md has:
#   - [Acme](10-domains/acme.md) — Enterprise, net-30
# but acme.md now also has ## Enrichment and ## Activity sections.
# Corrected bullet:
#   - [Acme](10-domains/acme.md) — Enterprise, net-30; enriched; active Q2 deal
```

**Scope limit:** check only files referenced in `MEMORY.md` that your
task is likely to touch — not a full recursive walk. One curator pass
per wake; move on. The goal is incremental convergence, not a
blocking audit.

## When to write

The framework auto-checkpoints every run's outcome into the
work's log file. **You don't have to remember to log.** What
you do have to remember:

1. **Persist owner directives establishing a standing rule.**
   `Write` `./drive/me/memory/20-decisions/<topic>.md` plus a
   one-line pointer in `./drive/me/memory/MEMORY.md`.
2. **Persist confirmed facts about the user's or tenant's world.**
   `Write` `./drive/me/memory/10-domains/<entity>.md` (or under
   `./drive/shared/memory/` if tenant-canonical) plus a pointer
   in `MEMORY.md`.
3. **When unsure, default to `60-daily/`.** If something might
   matter later — a passing remark, an in-flight observation,
   a half-formed pattern, a fact you can't yet route to
   `20-decisions/` or `10-domains/` — append a one-liner to
   `./drive/me/memory/60-daily/<YYYY-MM-DD>.md` (or
   the shared equivalent) and move on. Notes are the safety net
   against silent loss. The bar to capture is "I noticed it";
   the bar to promote out of notes is higher and comes later.

## How to write — the format

**`20-decisions/<topic>.md`** — one rule per file. Filename is the
topic in kebab-case (`commit-authoring.md`,
`communication-style.md`). Body is the rule + the why + the
source if relevant. Short.

```markdown
# Commit authoring

Never add `Co-Authored-By` lines to commit messages.

**Why:** Parag told me 2026-05-12 in copilot. He prefers credit
clean, no AI attribution.

**How to apply:** Strip `Co-Authored-By` from any commit template
before using it.
```

**`10-domains/<entity>.md`** — one entity per file. Filename is the
entity slug (`talker-network.md`, `acme.md`). Body is durable
facts.

```markdown
# Talker.Network

- Tier: Enterprise
- Contract: net-30
- Primary contact: parag@talker.network
- Source: confirmed by Parag 2026-05-12
```

**`MEMORY.md`** — the index. One line per pointer. **Update it
every time you write *or materially update* a `20-decisions/` or
`10-domains/` file — including appending a new section (e.g.
`## Activity`, `## Enrichment`) to an entity file that's already
indexed. The bullet must reflect the file's latest state, not
just its existence.** Pointers, not warehouses.

```markdown
## Standing rules
- [Commit authoring](20-decisions/commit-authoring.md) — no co-authors
- [Communication style](20-decisions/communication-style.md) — terse, no preamble

## Known entities
- [Talker.Network](10-domains/talker-network.md) — Enterprise, net-30
```

## Routing call: me vs shared

Ask: *"is this fact only true for this human, or for everyone
in the tenant?"*

- The user said "I prefer terse responses" → **me**
  (`./drive/me/memory/20-decisions/communication-style.md`)
- The user mentioned "Acme's payment terms are net-30" →
  **shared** (`./drive/shared/memory/10-domains/acme.md`) — every
  agent working with Acme should know this.
- The user described a customer contact's role → **shared**
- The user described their own workflow preference → **me**
- Vague observation you might want later → **60-daily/** in either
  scope (don't promote yet).

When in doubt: me-scope first. Promotion to shared is
intentional; demotion the other way is hard.

## Concrete worked example

User types: *"Always use net-30 terms for new Acme deals."*

You should run:

```bash
# 1. Sanity-check the path:
ls ./drive/me 2>/dev/null && echo "me-scope reachable"

# 2. Since this is about Acme (tenant entity), write to shared:
mkdir -p ./drive/shared/memory/domains
cat > ./drive/shared/memory/10-domains/acme.md <<'EOF'
# Acme

- Default contract: net-30 (per Parag, 2026-05-12)
- Source: copilot directive
EOF

# 3. Add a pointer to shared MEMORY.md (create if missing):
test -f ./drive/shared/memory/MEMORY.md || cat > ./drive/shared/memory/MEMORY.md <<'EOF'
# Shared memory

## Known entities
EOF
# Append the pointer (idempotent — grep first):
grep -q "10-domains/acme.md" ./drive/shared/memory/MEMORY.md || \
  echo "- [Acme](10-domains/acme.md) — Enterprise, net-30 by default" \
    >> ./drive/shared/memory/MEMORY.md

# 4. Verify:
ls ./drive/shared/memory/10-domains/
cat ./drive/shared/memory/MEMORY.md
```

THEN reply to the user — "Saved: Acme net-30 default → `shared/memory/10-domains/acme.md`, indexed in MEMORY.md."

## Anti-patterns

- **Don't lie about saving.** "Saved" without a `Write` call is
  forbidden. Persist first; *then* tell the user it's saved.
- **Don't use `framework.comments.post` as memory.** Comments
  are per-task transcript, not cross-run memory. They'll never
  be read on tomorrow's wake of a different task.
- **Don't dump in-run thinking here.** Memory is for cross-run
  continuity. In-run thinking belongs in comments on the task.
- **Don't skip the `MEMORY.md` pointer.** A `20-decisions/X.md`
  with no entry in `MEMORY.md` is invisible to future grep-
  based recall. Always update both.
- **Don't treat the pointer as write-once.** If you append to or
  materially change an already-indexed `10-domains/`/`20-decisions/`
  file, the existing bullet is now stale — refresh it. "I already
  added a pointer once" does not satisfy this.
- **Don't write to `./drive/users/<other>/`.** The mount only
  exposes the current wake-owner — siblings aren't reachable
  anyway, but `./drive/me/` is your only sanctioned write path
  on the user side.
- **Don't restate facts in multiple places.** One canonical
  home per fact. `MEMORY.md` carries pointers; the detail
  lives in the pointer's target.
- **Don't archive prematurely.** If a rule is still in force,
  leave it in `20-decisions/`. Move to `99-archive/` only when it's
  stale, superseded, or historical.

## Why the filesystem (not a memory API)

You're running with `--dangerously-skip-permissions`. `Read` /
`Grep` / `Glob` / `Bash` operate on `./drive/` at filesystem
speed — microseconds per call, no HTTP round-trip, composes
with shell pipelines. The `memory.*` tools that exist in the
framework's tool catalog go through HTTP for callers who don't
have a filesystem mount (the shell UI, scripts, webhooks). For
you, the filesystem is always faster, more transparent, and
more composable. Use it.

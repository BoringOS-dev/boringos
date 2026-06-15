# BoringOS Brain — OKF Compatibility Plan

> **Status: SHIPPED** (working tree, pending commit). All five units (U-OKF-1…5 / issues #68–#72, epic #73) are implemented and verified — unit + integration + a live faked-email end-to-end: 5 emails → facts citing `(src: inbox_items:<id>)` → distill → curate → `brain.export_okf` returns an OKF-§9-conformant bundle (0 violations, `okf_version 0.1`), the emailed facts are retrievable via `brain.search`, and 10 `cites` edges chain provenance back to the email rows. 53 brain + 36 adjacent tests green; zero regressions.

> Make the Brain's **files tier** (docs/brain.md §4.4–§4.5, the markdown memory tree) a **superset of [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)** — Google's Open Knowledge Format (v0.1). We keep everything that makes the Brain a *system* (Postgres retrieval, typed graph, distillation, curator, synthesis, MCP, multi-tenancy) and adopt OKF's *format* discipline so a tenant's memory tree is also a portable, vendor-neutral, OKF-conformant knowledge bundle.
>
> Companion to [`brain.md`](brain.md) (canonical plan) and [`brain-implementation.md`](brain-implementation.md) (what's built). Read after both.

---

## 1. Why

OKF is a **specified interchange format**: "a directory of markdown files with YAML frontmatter," deliberately minimal — *silent* on retrieval, embeddings, typed graphs, access control, multi-tenancy, and consumption. It is the layer we treat as convention; it punts everything else to "the downstream system." **Our Brain is that downstream system.**

Two payoffs, near-zero cost (we already do files-as-system-of-record + frontmatter + citations):

1. **Interop for free.** An OKF-conformant tree is readable by Obsidian / Notion / MkDocs / a static server / any LLM loading files / Dataplex-style catalogs / the OKF graph viewer — and importable/exportable across tools.
2. **Standard alignment.** "OKF-conformant store with a Postgres retrieval engine + typed graph + agentic synthesis on top" is a stronger position than a bespoke layout, and aligns us with a Google-published standard.

**Stance: superset, not slave.** OKF is v0.1, a Google proof-of-concept, no central authority, no scale story. We become *compatible* (a conformant superset) — low risk; we never let OKF's minimalism remove a Brain capability.

---

## 2. What we adopt vs keep

| OKF concept | Adopt? | Brain mapping |
|---|---|---|
| Concept = one `.md` doc; **Concept ID = path − `.md`** | ✅ adopt | already our `source_ref` (drive path). Aligned. |
| Frontmatter **required `type`** | ✅ adopt | new `type:` field → populates `brain__memories.kind` from the file (today inferred from the folder). |
| Frontmatter `resource` (canonical URI) | ✅ adopt | new `resource:` field → the canonical asset/row pointer (decision #11), standardized out of prose. |
| Frontmatter `title`/`description`/`tags`/`timestamp` | ✅ adopt | we already emit `tags`/`createdAt`; add `title`/`description`. |
| Body sections `# Schema` / `# Examples` / `# Citations` | ✅ adopt | `# Citations` ≈ our `(src: …)`; align the on-disk convention. |
| Per-directory `index.md` (progressive disclosure, no frontmatter) | ✅ adopt | new — curator generates one per folder, alongside the root `MEMORY.md`. |
| `log.md` (newest-first changelog) | ➕ superset | we have richer temporal tiers (`60-daily/`, `70-weekly/`); optionally emit a bundle-level `log.md` on export. |
| Absolute bundle-relative links recommended | ✅ adopt convention | our `[[wikilink]]` (slug-stable) + add bundle-relative link guidance. |
| Conformance + "consumers MUST tolerate" | ✅ adopt | formalize: parseable frontmatter, non-empty `type`, reserved files; curator reports non-conformance. |
| `okf_version` declared at bundle root | ✅ adopt | declare in the scope-root `index.md`/`MEMORY.md`. |
| **Untyped links** ("relationship in the prose") | ❌ keep ours | we keep **typed** edges (`mentions`/`cites`/`works_at`/…). Our links are OKF-valid; the typing is our value-add. |
| Numbered read-priority folders (`10-`…`99-`) | ❌ keep ours | OKF has no read ordering; deterministic read-order-on-wake is a Brain feature. `type` layers *on top* of the numbering, never replaces it. |
| Scope routing (`users/<id>/` vs `shared/`) | ❌ keep ours | multi-tenant/owner scope; OKF is silent. Each scope root is its own OKF bundle. |

**Net:** every BoringOS memory file becomes a valid OKF concept; every scope root (`shared/memory/`, `users/<id>/memory/`) becomes a valid OKF bundle. We add fields and per-dir indexes; we remove nothing.

---

## 3. Work units (→ GitHub issues)

Each is independently shippable + verified (unit + integration + live), same rhythm as the brain units.

### U-OKF-1 — Frontmatter `type` + `resource`
- `renderFrontmatter` (provider) + distillation promotion + curator emit `type:` (and `resource:` when known) on every written file/fragment.
- Indexer parses frontmatter `type` → `brain__memories.kind`; `resource` → a canonical pointer (and a `describes` edge to the asset).
- Type vocabulary: a *recommended* (not enforced) set — `domain`, `decision`, `person`, `operation`, `daily`, `weekly`, `note`, `run` — derived by default from the folder, overridable in frontmatter. Open-ended per OKF.
- Scaffold templates + memory SKILLs document the field.
- **Done:** a written memory file carries valid frontmatter incl. non-empty `type`; the brain row's `kind` reflects it; `resource` round-trips to a pointer/edge.

### U-OKF-2 — Per-directory `index.md` (progressive disclosure)
- Curator generates/maintains an `index.md` in each numbered folder: `* [Title](rel) - description`, no frontmatter (OKF §6).
- Auto-synthesizable + idempotent; root `MEMORY.md` stays the top index and points at the per-dir indexes.
- Read-order SKILL updated to descend index→index at scale.
- **Done:** after curate, each non-empty durable folder has a conformant `index.md`; re-run is a no-op.

### U-OKF-3 — Conformance check + `okf_version` + tolerance
- A conformance pass (folded into `brain.curate`, or `brain.okf_check`): every non-reserved `.md` has parseable frontmatter with a non-empty `type`; reserved files (`index.md`/`log.md`) follow OKF shape. Non-conformance → curator findings (and auto-fix: add a default `type` from the folder).
- Declare `okf_version: "0.1"` at each scope-root index.
- Document consumer tolerance (missing optional fields, unknown `type`, broken links).
- **Done:** `brain.curate` reports/【auto-fixes】conformance; a seeded non-conformant file is flagged + back-filled with a folder-derived `type`.

### U-OKF-4 — Citations + link convention alignment
- Standardize the on-disk citation form to OKF's `# Citations` numbered list **and** keep our inline `(src: …)` (both parse to `cites` provenance edges — already built).
- Recommend bundle-relative absolute links (`/10-domains/acme.md`) for cross-refs; keep `[[wikilink]]` as the typed-graph source.
- Indexer parses both citation forms into `cites` edges.
- **Done:** a file using `# Citations` and/or `(src: …)` produces the same `cites` edges; links resolve bundle-relative.

### U-OKF-5 — OKF bundle export (interop) + docs
- `brain.export_okf` tool: emit a scope's memory tree as an OKF-conformant bundle (directory / tarball), generating any missing `index.md` + an `okf_version` + an optional `log.md` from `70-weekly/`.
- Validate the emitted bundle against the §9 conformance rules.
- Update `brain-implementation.md` + the brain `README.md` to state "files tier is an OKF superset"; add an OKF section to the public strategy doc.
- (Stretch: `brain.import_okf` to ingest an external OKF bundle into a scope.)
- **Done:** export produces a bundle that passes OKF conformance and round-trips back through the indexer.

---

## 4. Back-compat & migration

- **Additive only.** Existing files without `type`/`resource` stay valid; the conformance pass (U-OKF-3) back-fills a folder-derived `type` lazily (on curate / on next write). No bulk migration, no breakage.
- Legacy `notes/` (pre-v2) and un-prefixed files are tolerated; the curator flags + can re-home them.
- The numbered-folder convention and scope routing are unchanged.

---

## 5. Conformance definition (BoringOS = OKF superset)

A BoringOS scope root (`shared/memory/`, `users/<id>/memory/`) is a conformant OKF bundle when:
1. every non-reserved `.md` has parseable YAML frontmatter with a non-empty `type` (U-OKF-1/3);
2. `index.md` / `log.md`, where present, follow OKF §6/§7 (U-OKF-2);
3. citations use `# Citations` and/or `(src: …)`, links are bundle-relative or relative (U-OKF-4);
4. `okf_version` is declared at the root (U-OKF-3).
Our *additions* (numbered folders, scope routing, typed `[[wikilinks]]`, Postgres mirror) are all OKF-legal — OKF tolerates unknown keys, extra files, and untyped-vs-typed links.

---

## 6. Testing

- **Unit:** frontmatter render/parse (`type`/`resource`), `index.md` generation, conformance checker, citation/link parsing.
- **Integration (real PG + drive):** write → file carries `type`/`resource` → indexer sets `kind` + `describes`/`cites` edges; curate generates per-dir `index.md` + back-fills missing `type` + flags non-conformance; export emits a bundle that passes §9 conformance and re-imports.
- **Live (HTTP):** `brain.remember` → inspect frontmatter on disk; `brain.curate` → per-dir indexes + conformance report; `brain.export_okf` → conformant bundle.
- Reuse the env discipline in `reference_embedded_pg_shm_limit` (clear shm before brain suites).

---

## 7. Non-goals / risks

- **Not adopting OKF wholesale.** We don't drop numbered folders, scope routing, or typed edges. Superset only.
- **OKF v0.1 churn.** It's a PoC; the spec may move. We pin to `0.1`, gate on `okf_version`, and keep our engine independent of OKF so a spec change is a frontmatter/export tweak, not an engine change.
- **No central authority.** Type values stay producer-defined (OKF stance); we ship a *recommended* vocabulary, not an enforced registry.

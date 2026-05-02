# Phase 4 — Marketplace Open

> Open the SDK and marketplace to third-party developers. Platform → ecosystem.

**Goal:** External developers can scaffold, build, test, publish, and install a third-party app or connector with no platform-team intervention.

**Phase 4 Gate:** First 10 third-party listings live. Public dev portal up. Signed-bundle pipeline operational.

---

## Workstreams (sketch)

| Code | Workstream | Outcome |
|---|---|---|
| **P** | Marketplace backend | Submission queue, automated review pipeline, human review tooling, signed-bundle distribution, CDN |
| **Q** | Marketplace UI | Browse / listing / install pages; ratings, reviews, install counts, verified-publisher badges |
| **R** | Dev portal | Public docs site, API references, publisher onboarding, key management, submission status, analytics |
| **S** | Signed bundles | Publisher key generation, bundle signing, signature verification at install |
| **T** | App update channels | Auto-patch / manual / locked; capability-diff prompts on major updates |

**Deferred:** `remote-app-runtime`. All apps still run in-process. Open the remote runtime only when a real third-party use case requires it.

Detail comes when Phase 3 is closed.

---

*Last updated: 2026-05-03*

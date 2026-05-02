# Phase 2 — CRM Port

> Re-implement CRM against the public App SDK as a third party would.

**Goal:** Prove the SDK contract works for a real, complex app. Port `boringos-crm` from a standalone SPA to a manifest-driven plugin that installs into the shell.

**Phase 2 Gate:** A fresh tenant can install CRM from the shell's Apps screen in under 30 seconds. CRM nav entries appear, agents seed, copilot picks up CRM context. **If the port required modifying the SDK, the contract is wrong — fix and re-port.**

**Phase 2 Risk:** if CRM cannot be ported using only the public SDK, we have a Phase 1 gap. Resolve before moving forward.

---

## Workstreams (sketch)

| Code | Workstream | Outcome |
|---|---|---|
| **F** | Strip CRM SPA chrome | Domain components survive; routing/auth/shell-host removed |
| **G** | Manifest-driven UI | All UI contributions go through manifest slots |
| **H** | Server-side `defineApp` | Schema, agents, workflows, context providers wired through SDK |
| **I** | First marketplace listing | CRM listed (single listing for now); install + uninstall flow tested |
| **J** | Public beta | Design partners migrated from standalone CRM to shell-hosted CRM |

Detail comes when Phase 1 is closed.

---

*Last updated: 2026-05-03*

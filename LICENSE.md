# License Matrix

This monorepo holds packages under multiple licenses. **The repository is mixed-license.** The license that applies to a given file is determined by the package it lives in.

The principle: **maximize adoption of primitives; protect the commercial surface.** Kernel packages and SDKs are permissive (MIT / Apache 2.0). The shell, control plane, and first-party apps are source-available under BSL 1.1 with auto-conversion to Apache 2.0 after 4 years.

For the full reasoning, see [`docs/licensing.md`](./docs/licensing.md).

---

## Matrix

| Path | SPDX | Why |
|---|---|---|
| `packages/@boringos/*` (kernel) | `MIT` | Maximize adoption; SDKs and primitives win by being everywhere |
| `packages/@boringos/connector-*` (Slack, Google) | `MIT` | Same reasoning; community-friendly |
| `packages/@boringos/app-sdk` | `MIT` | The contract third-party developers build apps against |
| `packages/@boringos/connector-sdk` | `MIT` | The contract third-party developers build connectors against |
| `packages/@boringos/shell` | `BUSL-1.1` (auto-converts to `Apache-2.0` after 4 yr) | Commercial surface; competitors blocked from hosting |
| `packages/@boringos/control-plane` | `BUSL-1.1` (auto-converts to `Apache-2.0` after 4 yr) | Same reasoning as shell |
| `apps/*` (first-party default apps) | `BUSL-1.1` (auto-converts to `Apache-2.0` after 4 yr) | Commercial product layer |

The repo-default `LICENSE` file at the root is **MIT** (the kernel's license, applies to anything not otherwise marked). Each package directory contains its own `LICENSE` file that overrides the root for that package.

---

## SPDX headers

Every source file starts with an SPDX header matching its package's license:

```ts
// SPDX-License-Identifier: MIT
```

```ts
// SPDX-License-Identifier: BUSL-1.1
```

CI fails any new file without a header. CI also verifies the header matches the package's `package.json` `license` field and the package's `LICENSE` file's SPDX header.

---

## BSL 1.1 specifics

Packages licensed under BSL 1.1:

- **Allow:** read, audit, modify, use in production for non-competing use cases (including running internally for your organization)
- **Prohibit:** offer the code as a competing managed service (e.g. "BusinessOS-as-a-Service")
- **Auto-convert:** four years after a version's release, that version becomes Apache 2.0

If you have a use case that may fall on the edge of "competing managed service," contact us. Additional grants are routinely available.

---

## CLA

Contributions to permissively-licensed packages (MIT / Apache 2.0) require signing the [CLA](./CLA.md). This is enforced by a GitHub bot. Contributions to BSL-licensed packages do not require a CLA but are still subject to contribution review.

---

*Last updated: 2026-05-03*

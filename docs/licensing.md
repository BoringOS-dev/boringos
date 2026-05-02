# Licensing

> The license matrix for BusinessOS — what's permissive, what's protected, and why.

This doc captures the licensing model across the platform, the reasoning behind each choice, and the rules contributors and third-party developers need to know.

**Audience:** Contributors, third-party developers, legal review.

---

## 1. The Strategy in One Line

**Maximize adoption of the primitives. Protect the commercial surface.**

Frameworks, SDKs, and connectors are permissively licensed (MIT / Apache 2.0) so the ecosystem grows. The shell, first-party apps, and hosted control plane are source-available under BSL — competitors cannot offer a managed BusinessOS-as-a-service, but the code is auditable, forkable for non-competing use, and converts to Apache 2.0 after a defined period.

This follows the **Sentry / MariaDB / CockroachDB / HashiCorp** pattern, not the WordPress-everywhere-GPL pattern. We chose this because the WP route protects via brand and operational quality alone; we want the same ecosystem effect plus an explicit commercial moat.

---

## 2. The License Matrix

| Component                              | License            | SPDX            | Why                                                                                  |
| -------------------------------------- | ------------------ | --------------- | ------------------------------------------------------------------------------------ |
| `boringos-framework` (runtime)         | MIT                | `MIT`           | Maximize adoption; SDKs and primitives win by being everywhere                       |
| `@boringos/connector-*` (built-in connectors) | MIT         | `MIT`           | Same reasoning; community-friendly                                                   |
| `@businessos/connector-sdk`            | MIT                | `MIT`           | The contract third parties build connectors against                                  |
| `@businessos/app-sdk`                  | Apache 2.0         | `Apache-2.0`    | Includes patent grant; the contract third parties build apps against                 |
| `@boringos/shell` (the wp-admin)       | BSL 1.1, converts to Apache 2.0 after 4 years | `BUSL-1.1`      | Commercial surface; competitors blocked from hosting; sunsets to permissive            |
| First-party apps (CRM, Accounts, etc.) | BSL 1.1, converts to Apache 2.0 after 4 years | `BUSL-1.1`      | Sold products; same model as shell                                                   |
| Hosted control plane (marketplace, billing, ops) | Closed source | n/a            | No reason to publish; pure operational layer                                         |
| Third-party connectors                 | Author's choice    | per repo        | Author decides; we recommend MIT or Apache 2.0                                       |
| Third-party apps                       | Author's choice    | per repo        | Author decides; commercial apps typically pick BSL or proprietary                    |

---

## 3. BSL Specifics

The Business Source License (BSL 1.1) is **source-available**, not open-source by OSI definition. It allows:

- Reading, auditing, modifying the code
- Using the code in non-production environments
- Using the code in production *for non-competing use cases*

It prohibits:

- Offering the code as a competing managed service (this is the protection we want)

After **4 years** from the release of each version, that version automatically converts to **Apache 2.0**. So today's shell becomes fully open source in 2030; today's CRM becomes Apache 2.0 in 2030; the cycle continues per release.

**Why 4 years:** long enough that the platform has time to establish a hosted lead; short enough that the community sees a real timeline to permissiveness.

**Additional grants:** companies running BusinessOS internally (not as a managed service to others) are unaffected. Self-hosting for your own organization is permitted from day one.

---

## 4. CLA (Contributor License Agreement)

The framework already has `CLA.md` enforced via the bot. This applies to any permissively-licensed package (MIT / Apache 2.0) we maintain.

**Why we require a CLA:**

- Without it, we cannot relicense our own code in the future. External contributors hold copyrights we can't override.
- The MIT/Apache 2.0 packages are the foundation; we must preserve the option to dual-license, change to a more protective license, or grant unusual rights to specific customers.

**The CLA grants us:**

- Copyright assignment OR perpetual unlimited license to the contribution
- Patent grant
- The right to relicense

**The CLA does not grant us:**

- Exclusive ownership (contributor keeps their copyright in the assignment-version)
- Any rights to the contributor's other code

CLA is enforced via a GitHub bot on every PR to permissively-licensed repos. PRs from un-signed contributors are blocked until the CLA is signed.

---

## 5. License Headers

Every source file in our repos starts with an SPDX header:

```ts
// SPDX-License-Identifier: MIT
```

```ts
// SPDX-License-Identifier: Apache-2.0
```

```ts
// SPDX-License-Identifier: BUSL-1.1
```

A lint rule fails any new file without a header. CI also verifies that:

- The header matches the package's `package.json` `license` field
- The package's `LICENSE` file matches the header

This prevents accidental license drift across the monorepo.

---

## 6. License File Hierarchy

```
repo-root/
  LICENSE              ← repo-default license (full text)
  LICENSE.md           ← matrix index for monorepos with mixed licenses
  packages/
    framework/
      LICENSE          ← MIT full text (overrides repo-default if different)
      package.json     ← "license": "MIT"
    shell/
      LICENSE          ← BSL full text + grant of additional permissions
      package.json     ← "license": "BUSL-1.1"
```

The top-level `LICENSE.md` is a developer-facing index explaining the matrix; it is not itself a license.

---

## 7. Third-Party Code in Our Repos

When we vendor or fork third-party code:

- The code's original license stays in place
- A `THIRD_PARTY_NOTICES.md` file at the repo root lists every dependency and its license
- We never ingest GPL / AGPL code into permissive packages (would virally relicense them)
- We never ingest BSL or non-OSI source-available code into permissive packages

This is enforced by a license-scan job on every CI run.

---

## 8. Marketplace Submission Licensing

Apps and connectors submitted to the BusinessOS marketplace must declare a license in their manifest:

```json
{ "license": "MIT" }
{ "license": "Apache-2.0" }
{ "license": "BUSL-1.1" }
{ "license": "Proprietary" }
```

Marketplace policy:

- **Permissive (MIT / Apache 2.0)**: encouraged for community apps, listed with "Open Source" badge
- **Source-available (BSL / FSL)**: allowed; commercial publishers commonly use this
- **Proprietary**: allowed; closed-source paid apps; no source link shown
- **GPL / AGPL**: allowed but discouraged for *apps* (license complexity for users); allowed for connectors
- **No license declared**: rejected at submission

The `license` field is shown on the marketplace listing so tenants can decide how the licensing affects their use.

---

## 9. Forking & Self-Hosting

The framework (MIT) is freely forkable. The shell (BSL) is forkable for non-competing use — meaning a company can fork to deploy internally for itself, customize, and run forever. They cannot fork and offer it as a competing hosted service.

Examples of permitted use under BSL:

- A 5,000-person company self-hosts BusinessOS for its own employees and customers' employees (not as a managed service)
- A consultancy customizes the shell for a client and deploys to that client's infrastructure
- A research team forks the shell to study agentic platforms

Examples of prohibited use under BSL:

- A SaaS startup forks the shell and launches "AcmeOS — like BusinessOS but with our spin" as a hosted product
- A cloud provider offers "Managed BusinessOS" as part of its service catalog (without an agreement with us)

When in doubt, contact us. We grant additional permissions liberally for non-competing edge cases.

---

## 10. Future Adjustments

Reserved for changes we may make as the platform matures:

- **Apache 2.0 across the framework.** If patent risk becomes material, we may move framework packages from MIT to Apache 2.0. The CLA permits this for our own code; CLA-signed external contributions are also covered. Without a CLA we couldn't make this move.
- **Foundation hand-off.** If the framework reaches sufficient maturity and ecosystem, we may donate it to a foundation (CNCF, Apache, OpenJS) and step back from primary maintenance — keeping the shell + apps as our commercial focus.
- **Earlier BSL conversion.** We may shorten the BSL → Apache 2.0 conversion window from 4 years to 3 if the commercial moat is durable enough that earlier conversion accelerates ecosystem trust.

These are options, not commitments.

---

## 11. Reading Order From Here

- [Overview](./overview.md) — the architecture this licensing model maps to
- [Publishing & Install](./developer/publishing-and-install.md) — marketplace policies enforce licensing declarations
- `CLA.md` (in each permissively-licensed repo) — full CLA text and signing flow

---

*Last updated: 2026-04-30*

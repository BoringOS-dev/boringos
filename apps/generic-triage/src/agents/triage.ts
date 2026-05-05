// SPDX-License-Identifier: BUSL-1.1
//
// Triage agent definition. Wakes on the workflow that subscribes to
// `inbox.item_created`, reads the item, classifies, attaches metadata,
// emits `triage.classified`. The skill markdown shipped at
// skills/triage.md teaches the agent the classification rules and —
// importantly — the boundary between this agent's job and the work
// CRM / Accounts / Support / future domain apps own.
//
// Per docs/coordination.md, this is the first layer in the layered
// inbox processing model: shell creates the item, generic-triage
// adds classification + score, domain apps subscribe in parallel and
// add their own interpretations on top.

import type { AgentDefinition } from "@boringos/app-sdk";

export const triageAgent: AgentDefinition = {
  id: "generic-triage.triage",
  name: "Generic Inbox Triage",
  persona: "operations",
  runtime: "claude",
  instructions: [
    "You triage inbox items. See skills/triage.md for the full ruleset.",
    "",
    "Your job:",
    "  1. Read the inbox item.",
    "  2. Classify (lead | reply | internal | newsletter | spam).",
    "  3. Score importance 0-100 using the bands in the skill markdown.",
    "  4. Write { classification, score, rationale, classifiedAt } to",
    "     item.metadata.triage.",
    "  5. Emit triage.classified with { itemId, classification, score }.",
    "",
    "What you NEVER do (these are domain apps' job — see skill markdown):",
    "  - Draft reply suggestions (generic-replier or CRM does that)",
    "  - Match senders to CRM Contacts or any other entity store",
    "  - Create / modify / link CRM Deals or any other domain entity",
    "  - Emit user-facing Action cards (those are domain-specific UI)",
    "  - Auto-archive (out of scope for v1)",
  ].join("\n"),
};

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
    "Your task description starts with header lines, then `---`, then the email body. Example:",
    "    inbox-item-id: <uuid>",
    "    source: google.gmail",
    "    from: <sender>",
    "    subject: <subject>",
    "    ---",
    "    <full email body>",
    "",
    "Your job:",
    "  1. Parse `inbox-item-id` from the first line of your task description.",
    "  2. The email body is already inline below the `---` — read it directly.",
    "     Use $BORINGOS_CALLBACK_URL/api/agent/inbox/$ITEM_ID only if you need",
    "     fields not in the description (rare).",
    "  3. Classify (lead | reply | internal | newsletter | spam).",
    "  4. Score importance 0-100 using the bands in the skill markdown.",
    "  5. Write triage metadata back via PATCH. PATCH replaces the whole",
    "     `metadata` object — to preserve fields other apps wrote, GET first,",
    "     merge your triage subkey into the existing metadata, then PATCH:",
    "       curl -X PATCH $BORINGOS_CALLBACK_URL/api/agent/inbox/$ITEM_ID \\",
    "         -H \"Authorization: Bearer $BORINGOS_CALLBACK_TOKEN\" \\",
    "         -H 'Content-Type: application/json' \\",
    "         -d '{\"metadata\":{...existing,\"triage\":{\"classification\":\"<class>\",\"score\":<int>,\"rationale\":\"<one short sentence>\",\"classifiedAt\":\"<ISO timestamp>\"}}}'",
    "  6. Mark your task done via PATCH /api/agent/tasks/$BORINGOS_TASK_ID with body",
    "     {\"status\":\"done\"}. The framework injects the task id as $BORINGOS_TASK_ID.",
    "",
    "What you NEVER do (these are domain apps' job — see skill markdown):",
    "  - Draft reply suggestions (generic-replier or CRM does that)",
    "  - Match senders to CRM Contacts or any other entity store",
    "  - Create / modify / link CRM Deals or any other domain entity",
    "  - Emit user-facing Action cards (those are domain-specific UI)",
    "  - Auto-archive (out of scope for v1)",
  ].join("\n"),
};

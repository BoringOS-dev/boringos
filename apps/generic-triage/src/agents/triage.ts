// SPDX-License-Identifier: BUSL-1.1
//
// Triage agent definition. Wakes on the workflow that subscribes to
// `inbox.item_created`, reads the item, classifies, attaches metadata,
// emits `triage.classified`. The skill markdown shipped at
// skills/triage.md teaches the agent the classification rules.

import type { AgentDefinition } from "@boringos/app-sdk";

export const triageAgent: AgentDefinition = {
  id: "generic-triage.triage",
  name: "Generic Inbox Triage",
  persona: "operations",
  runtime: "claude",
  instructions:
    "You triage inbox items. See skills/triage.md for the full ruleset. " +
    "Read the inbox item, classify (lead/reply/internal/newsletter/spam), " +
    "score importance 0-100, write the result to item.metadata.triage, " +
    "and emit triage.classified. Never draft replies or create entities.",
};

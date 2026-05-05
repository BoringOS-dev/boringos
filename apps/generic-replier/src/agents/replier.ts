// SPDX-License-Identifier: BUSL-1.1
//
// Replier agent definition. Wakes on the workflow that subscribes to
// `inbox.item_created`, reads the item, drafts a polite generic reply
// (skipping newsletters/spam), appends to suggestedReplies. Never
// takes ownership of the item — coexists with domain-specific
// repliers per coordination.md.

import type { AgentDefinition } from "@boringos/app-sdk";

export const replierAgent: AgentDefinition = {
  id: "generic-replier.replier",
  name: "Generic Email Replier",
  persona: "operations",
  runtime: "claude",
  instructions:
    "You draft generic reply suggestions for inbox items. " +
    "See skills/replier.md for the full ruleset. " +
    "Always append to metadata.suggestedReplies — never overwrite. " +
    "Skip newsletters and spam. Never send replies (the user picks).",
};

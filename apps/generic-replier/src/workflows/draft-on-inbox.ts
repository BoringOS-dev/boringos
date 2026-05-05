// SPDX-License-Identifier: BUSL-1.1
//
// Workflow template — installed at tenant provision. On every
// inbox.item_created event, wakes the replier agent.
//
// Independent of generic-triage's workflow: both subscribe to the
// same event, run in parallel, contribute different things (Triage
// classifies, Replier drafts a suggestion). No ordering dependency.

import type { WorkflowTemplate } from "@boringos/app-sdk";

export const draftOnInboxItemCreated: WorkflowTemplate = {
  id: "generic-replier.draft-on-inbox",
  name: "Draft generic reply for incoming items",
  description:
    "On every inbox.item_created event, wake the Generic Email Replier " +
    "agent to append a reply suggestion to the item. Coexists with " +
    "domain-specific repliers — multiple apps can suggest, the user picks.",
  blocks: [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      config: { eventType: "inbox.item_created" },
    },
    {
      id: "wake-replier",
      name: "wake-replier",
      type: "wake-agent",
      config: { agentId: "generic-replier.replier" },
    },
  ],
  edges: [
    {
      id: "e1",
      sourceBlockId: "trigger",
      targetBlockId: "wake-replier",
      sourceHandle: null,
      sortOrder: 0,
    },
  ],
  triggers: [{ type: "event", event: "inbox.item_created" }],
  installAt: "tenant_created",
};

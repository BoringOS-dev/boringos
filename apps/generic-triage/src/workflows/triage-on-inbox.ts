// SPDX-License-Identifier: BUSL-1.1
//
// Workflow template — installed at tenant provision. On every
// inbox.item_created event, wakes the triage agent.

import type { WorkflowTemplate } from "@boringos/app-sdk";

export const triageOnInboxItemCreated: WorkflowTemplate = {
  id: "generic-triage.triage-on-inbox",
  name: "Triage incoming inbox items",
  description:
    "On every inbox.item_created event, wake the Generic Inbox Triage agent " +
    "to classify the item and attach metadata. Other apps (Generic Replier, " +
    "CRM, etc.) subscribe to the same event independently and add their own " +
    "interpretation; this workflow does not gate them.",
  blocks: [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      config: { eventType: "inbox.item_created" },
    },
    {
      id: "wake-triage",
      name: "wake-triage",
      type: "wake-agent",
      config: { agentId: "generic-triage.triage" },
    },
  ],
  edges: [
    {
      id: "e1",
      sourceBlockId: "trigger",
      targetBlockId: "wake-triage",
      sourceHandle: null,
      sortOrder: 0,
    },
  ],
  triggers: [{ type: "event", event: "inbox.item_created" }],
  installAt: "tenant_created",
};

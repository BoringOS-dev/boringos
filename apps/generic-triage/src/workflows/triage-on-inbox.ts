// SPDX-License-Identifier: BUSL-1.1
//
// Workflow template — installed at tenant provision. On every
// inbox.item_created event, wakes the triage agent.

import type { WorkflowTemplate } from "@boringos/app-sdk";

export const triageOnInboxItemCreated: WorkflowTemplate = {
  id: "generic-triage.triage-on-inbox",
  name: "Triage incoming inbox items",
  description:
    "On every inbox.item_created event, create a task and wake the Generic Inbox Triage agent " +
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
      id: "create-task",
      name: "create-task",
      type: "create-task",
      config: {
        title: "Triage inbox item: {{trigger.subject}}",
        // The task description is the only field the task context
        // provider surfaces to the agent prompt (title + description
        // + status/priority). Embed the inboxItemId on the first line
        // so the agent can parse it out, then include the email body
        // verbatim so the agent doesn't need a separate GET roundtrip
        // for routine cases. The PATCH still uses the agent callback
        // API to write metadata back.
        description:
          "inbox-item-id: {{trigger.itemId}}\n" +
          "source: {{trigger.source}}\n" +
          "from: {{trigger.from}}\n" +
          "subject: {{trigger.subject}}\n" +
          "---\n" +
          "{{trigger.body}}",
        status: "todo",
        // Use a stable origin so re-installation / re-emission doesn't
        // pile up dupes. dedup=true skips when a non-terminal task with
        // the same (originKind, originId) already exists.
        originKind: "inbox.item_created",
        originId: "{{trigger.itemId}}",
        dedup: true,
      },
    },
    {
      id: "wake-triage",
      name: "wake-triage",
      type: "wake-agent",
      config: {
        agentId: "generic-triage.triage",
        taskId: "{{create-task.taskId}}",
      },
    },
  ],
  edges: [
    {
      id: "e1",
      sourceBlockId: "trigger",
      targetBlockId: "create-task",
      sourceHandle: null,
      sortOrder: 0,
    },
    {
      id: "e2",
      sourceBlockId: "create-task",
      targetBlockId: "wake-triage",
      sourceHandle: null,
      sortOrder: 0,
    },
  ],
  triggers: [{ type: "event", event: "inbox.item_created" }],
  installAt: "tenant_created",
};

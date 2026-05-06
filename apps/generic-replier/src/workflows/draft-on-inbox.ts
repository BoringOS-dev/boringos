// SPDX-License-Identifier: BUSL-1.1
//
// Workflow template — installed at tenant provision. On every
// inbox.item_created event, creates a per-item task carrying the
// inbox-item-id + email body, then wakes the replier agent on that
// task so the agent prompt has the content it needs to draft.
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
      id: "create-task",
      name: "create-task",
      type: "create-task",
      config: {
        title: "Append reply draft to inbox item {{trigger.itemId}}",
        // The description leads with an explicit imperative because both
        // Haiku and Sonnet otherwise read the email body as passive
        // content and reply "No response requested." Putting the action
        // in the user-message portion of the prompt is what flips the
        // model into tool-use mode (verified empirically against the
        // triage path which uses the same shape).
        description:
          "ACTION: Use the Bash tool to append a generic reply draft to this inbox item's `metadata.replyDrafts[]` via PATCH /api/agent/inbox/{{trigger.itemId}}.\n" +
          "If the email is a newsletter, automated notice, or spam, skip drafting; just mark the task done.\n" +
          "Otherwise: GET the item, draft a polite reply (3-6 sentences), append your draft to the existing replyDrafts array, PATCH the merged metadata, then mark the task done.\n" +
          "Do not respond with prose. Use Bash + curl. Your run is incomplete until the PATCH succeeds.\n" +
          "\n" +
          "--- email follows ---\n" +
          "inbox-item-id: {{trigger.itemId}}\n" +
          "source: {{trigger.source}}\n" +
          "from: {{trigger.from}}\n" +
          "subject: {{trigger.subject}}\n" +
          "---\n" +
          "{{trigger.body}}",
        status: "todo",
        // Distinct originKind from triage so dedup is per-(workflow,
        // item) — both can produce a task for the same inbox item
        // without clobbering each other.
        originKind: "inbox.draft_reply",
        originId: "{{trigger.itemId}}",
        dedup: true,
      },
    },
    {
      id: "wake-replier",
      name: "wake-replier",
      type: "wake-agent",
      config: {
        agentId: "generic-replier.replier",
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
      targetBlockId: "wake-replier",
      sourceHandle: null,
      sortOrder: 0,
    },
  ],
  triggers: [{ type: "event", event: "inbox.item_created" }],
  installAt: "tenant_created",
};

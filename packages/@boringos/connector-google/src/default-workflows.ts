// SPDX-License-Identifier: MIT
//
// Default workflow + routine the Google connector installs on a fresh
// connection (N5). Pulls the last 15 minutes of email into the inbox
// every 15 minutes; the create-inbox-item handler emits
// inbox.item_created so generic-triage and any installed CRM email-lens
// agent wake automatically.
//
// Shipped as plain specs (no DB writes here) so the install pipeline
// can decide where + when to write — install path lives in
// @boringos/core/connectors/post-connect.ts.

import type { DefaultWorkflowSpec } from "@boringos/connector";

export const GMAIL_SYNC_TAG = "google.gmail-sync";

export function buildGmailSyncSpec(): DefaultWorkflowSpec {
  return {
    tag: GMAIL_SYNC_TAG,
    name: "Gmail sync",
    description:
      "Pull recent emails into the inbox every 15 minutes so triage + reply agents can react.",
    blocks: [
      {
        id: "trigger",
        name: "trigger",
        type: "trigger",
        config: {},
      },
      {
        id: "fetch",
        name: "fetch",
        type: "connector-action",
        config: {
          connectorKind: "google",
          action: "list_emails",
          inputs: {
            query: "newer_than:15m",
            maxResults: 25,
          },
        },
      },
      {
        // Batch-create inbox items directly from fetch.messages —
        // create-inbox-item maps each entry's subject/snippet/from
        // fields onto inbox columns, and dedups via sourceId so
        // re-running the sync is idempotent.
        id: "store",
        name: "store",
        type: "create-inbox-item",
        config: {
          source: "google.gmail",
          items: "{{fetch.messages}}",
        },
      },
    ],
    edges: [
      { id: "e1", sourceBlockId: "trigger", targetBlockId: "fetch", sourceHandle: null, sortOrder: 0 },
      { id: "e2", sourceBlockId: "fetch", targetBlockId: "store", sourceHandle: null, sortOrder: 0 },
    ],
    routine: {
      title: "Gmail sync (every 15 min)",
      cronExpression: "*/15 * * * *",
      timezone: "UTC",
    },
  };
}

/** All default workflows the Google connector installs on connect. */
export function googleDefaultWorkflows(): DefaultWorkflowSpec[] {
  return [buildGmailSyncSpec()];
}

// SPDX-License-Identifier: BUSL-1.1
//
// Generic Email Replier — pre-installed first-party default app.
// Built using only @boringos/app-sdk; same surface third-party
// authors use.

import { defineApp } from "@boringos/app-sdk";

import { replierAgent } from "./agents/replier.js";
import { draftOnInboxItemCreated } from "./workflows/draft-on-inbox.js";

export default defineApp({
  id: "generic-replier",
  agents: [replierAgent],
  workflows: [draftOnInboxItemCreated],
});

// Re-exports so E3's default-app provisioning can pick the manifest
// data without round-tripping through the filesystem.
export { replierAgent, draftOnInboxItemCreated };

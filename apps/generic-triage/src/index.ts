// SPDX-License-Identifier: BUSL-1.1
//
// Generic Inbox Triage — pre-installed first-party default app.
// Built using only the public @boringos/app-sdk to prove third-party
// authors can ship apps with the same surface.

import { defineApp } from "@boringos/app-sdk";

import { triageAgent } from "./agents/triage.js";
import { triageOnInboxItemCreated } from "./workflows/triage-on-inbox.js";

export default defineApp({
  id: "generic-triage",
  agents: [triageAgent],
  workflows: [triageOnInboxItemCreated],
});

// Re-exports so adjacent code (E3 default-app provisioning) can read
// the manifest path without round-tripping through filesystem.
export { triageAgent, triageOnInboxItemCreated };

// SPDX-License-Identifier: BUSL-1.1
//
// Mock marketplace listings for the v1 Browse tab. The real marketplace
// backend lands in Phase 4; until then this curated set lets the UI
// render against a fixed shape.

import type { MarketplaceListing } from "./types.js";

export const MOCK_LISTINGS: MarketplaceListing[] = [
  {
    id: "crm",
    name: "CRM",
    publisher: "BoringOS",
    verified: true,
    firstParty: true,
    description:
      "Contacts, companies, deals, pipelines. The reference first-party app.",
    category: "CRM",
    installs: 0,
    rating: 0,
    license: "BUSL-1.1",
  },
  {
    id: "generic-triage",
    name: "Generic Inbox Triage",
    publisher: "BoringOS",
    verified: true,
    firstParty: true,
    description:
      "Classifies inbox items, scores importance, attaches metadata. Pre-installed.",
    category: "Productivity",
    installs: 0,
    rating: 0,
    license: "BUSL-1.1",
  },
  {
    id: "generic-replier",
    name: "Generic Email Replier",
    publisher: "BoringOS",
    verified: true,
    firstParty: true,
    description:
      "Drafts a generic reply suggestion when no domain-specific app does. Pre-installed.",
    category: "Productivity",
    installs: 0,
    rating: 0,
    license: "BUSL-1.1",
  },
  {
    id: "accounts",
    name: "Accounts",
    publisher: "BoringOS",
    verified: true,
    firstParty: true,
    description:
      "Invoices, payments, chart of accounts. Cross-app entity reads with CRM. Coming soon.",
    category: "Finance",
    installs: 0,
    rating: 0,
    license: "BUSL-1.1",
  },
];

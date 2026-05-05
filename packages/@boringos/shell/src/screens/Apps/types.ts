// SPDX-License-Identifier: BUSL-1.1
//
// Local types for the Apps screen. The marketplace listing shape is a
// stable subset of what the marketplace backend (Phase 4) will return;
// the v1 Browse tab uses mock data of this shape so the UI is built
// against a real contract rather than freeform JSON.

export interface MarketplaceListing {
  id: string;
  name: string;
  publisher: string;
  verified: boolean;
  description: string;
  category: string;
  installs: number;
  rating: number;
  /** SPDX identifier (MIT, BUSL-1.1, Proprietary, …). */
  license: string;
  /** First-party flag — shown as a small badge in the UI. */
  firstParty?: boolean;
  /**
   * Source URL the install pipeline can fetch the manifest from.
   * Set on real marketplace entries; absent on mocks so the Install
   * button stays disabled until Phase 4 wires real listings.
   */
  installUrl?: string;
}

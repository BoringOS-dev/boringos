// SPDX-License-Identifier: BUSL-1.1
//
// Brand contract — what every shell consumer reads via useBrand().
// Per docs/shell-screens.md § 13 (Branding subsection).

export interface Brand {
  /** Replaces "BoringOS" everywhere in shell chrome (top bar, page titles, emails). */
  productName: string;

  /** Optional secondary line shown below the product name in some chrome. */
  productTagline: string;

  /** URL of the logo rendered in the top-left and outbound emails. */
  logoUrl: string;

  /** Browser tab icon. */
  faviconUrl: string;

  /** Primary brand color (CSS color string). */
  primaryColor: string;

  /** Secondary brand color (CSS color string). */
  secondaryColor: string;

  /** Optional background image shown on login/signup. */
  loginBackground: string;

  /** Sender display name on outbound notifications. */
  emailFromName: string;
}

export type PartialBrand = Partial<Brand>;

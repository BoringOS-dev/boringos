// SPDX-License-Identifier: BUSL-1.1
//
// Default BoringOS brand. Used when a tenant has not customized any
// brand.* setting in tenant_settings.

import type { Brand } from "./types.js";

export const BORINGOS_BRAND: Brand = {
  productName: "BoringOS",
  productTagline: "",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "#2563eb", // tailwind blue-600
  secondaryColor: "#0f172a", // tailwind slate-900
  loginBackground: "",
  emailFromName: "BoringOS",
};

/**
 * Map a partial brand from tenant_settings (with brand.* keys) to a
 * fully-resolved Brand by filling in any missing field with the
 * BoringOS default.
 */
export function resolveBrand(partial: Partial<Brand>): Brand {
  return {
    productName: partial.productName?.trim() || BORINGOS_BRAND.productName,
    productTagline: partial.productTagline?.trim() ?? BORINGOS_BRAND.productTagline,
    logoUrl: partial.logoUrl?.trim() ?? BORINGOS_BRAND.logoUrl,
    faviconUrl: partial.faviconUrl?.trim() ?? BORINGOS_BRAND.faviconUrl,
    primaryColor: partial.primaryColor?.trim() || BORINGOS_BRAND.primaryColor,
    secondaryColor: partial.secondaryColor?.trim() || BORINGOS_BRAND.secondaryColor,
    loginBackground: partial.loginBackground?.trim() ?? BORINGOS_BRAND.loginBackground,
    emailFromName: partial.emailFromName?.trim() || BORINGOS_BRAND.emailFromName,
  };
}

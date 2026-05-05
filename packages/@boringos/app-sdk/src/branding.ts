// SPDX-License-Identifier: MIT
//
// Branding API — types for the tenant brand the shell exposes via its
// BrandProvider. Apps that want to render in the tenant's brand import
// the Brand type from here for typing.
//
// The `useBrand()` hook itself lives in @boringos/shell because it
// depends on a React context that only the shell provides. Apps that
// want the hook re-export from the shell at runtime, but type their
// code against the Brand interface declared here so they don't take a
// runtime dependency on the shell.

export interface Brand {
  productName: string;
  productTagline: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  loginBackground: string;
  emailFromName: string;
}

/**
 * The fields a tenant can override. Identical to Brand for v1; the
 * separation exists so future fields can be marked "compute, not
 * configure" without breaking the public type.
 */
export type PartialBrand = Partial<Brand>;

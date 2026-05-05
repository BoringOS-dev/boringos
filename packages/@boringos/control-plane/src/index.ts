// SPDX-License-Identifier: BUSL-1.1
//
// @boringos/control-plane — orchestration between framework runtime
// and shell. Install/uninstall pipeline, manifest fetcher + validator,
// default-app provisioning.

export {
  parseRepoUrl,
  fetchManifest,
  type ParsedRepoUrl,
  type FetchedManifest,
  type FetcherOptions,
} from "./fetcher.js";

export {
  validateManifestFull,
  checkCapabilityHonesty,
  type ManifestValidationResult,
  type ValidationIssue,
} from "./validator.js";

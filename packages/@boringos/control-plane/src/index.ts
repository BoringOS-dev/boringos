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

export {
  installApp,
  InstallError,
  type InstallContext,
  type InstallArgs,
  type InstallRecord,
  type InstallPipelineDb,
  type SlotInstallRuntime,
  type InstallEventBus,
  type TenantAppRow,
} from "./install.js";

export {
  uninstallApp,
  UninstallError,
  type UninstallContext,
  type UninstallArgs,
  type UninstallResult,
  type UninstallMode,
  type UninstallPipelineDb,
  type AppLinkRow,
} from "./uninstall.js";

export {
  installDefaultApps,
  DEFAULT_APPS_CATALOG,
  type DefaultAppEntry,
  type DefaultAppOutcome,
  type DefaultAppsResult,
} from "./default-apps.js";

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

export {
  createDrizzleInstallDb,
  bindDrizzleInstallDbToTx,
  runAppMigrations,
  SchemaMigratorError,
  registerAppAgents,
  registerAgentsFromDefinition,
  AgentRegistrarError,
  registerAppWorkflows,
  registerWorkflowsFromDefinition,
  WorkflowRegistrarError,
  createAppRouteRegistry,
  registerAppRoutes,
  unregisterAppRoutes,
  createLifecycleContext,
  invokeOnTenantCreated,
  createActionContext,
  createDrizzleUninstallDb,
  createKernelInstallContext,
  loadCatalogFromDisk,
  loadCatalogStrict,
  CatalogLoaderError,
  type DrizzleInstallDb,
  type DrizzleTx,
  type RunAppMigrationsArgs,
  type RunAppMigrationsResult,
  type AppMigrationRecord,
  type RegisterAppAgentsArgs,
  type RegisterAppAgentsResult,
  type RegisteredAgent,
  type RegisterAppWorkflowsArgs,
  type RegisterAppWorkflowsResult,
  type RegisteredWorkflow,
  type WorkflowTriggerSpec,
  type AppRouteRegistry,
  type CreateAppRouteRegistryOptions,
  type InstallAppRoutesArgs,
  type InstalledRouteMount,
  type ApiCatalogEntry,
  type AgentDocs,
  type CreateLifecycleContextArgs,
  type ActionEventBus,
  type CreateActionContextArgs,
  type DrizzleUninstallDbOptions,
  type KernelInstallContext,
  type KernelInstallContextOptions,
  type KernelInstallArgs,
  type KernelUninstallArgs,
  type LoadCatalogOptions,
  type LoadCatalogResult,
  type CatalogLoaderEntryError,
} from "./adapters/index.js";

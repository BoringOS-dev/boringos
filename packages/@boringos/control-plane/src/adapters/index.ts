// SPDX-License-Identifier: BUSL-1.1
//
// Kernel-side adapters that wire the pure C5 install pipeline (install.ts,
// uninstall.ts) to the framework's real Drizzle / InstallRuntime / event
// bus / app builder. Phase 2, K1-K7.

export {
  createDrizzleInstallDb,
  bindDrizzleInstallDbToTx,
  type DrizzleInstallDb,
  type DrizzleTx,
} from "./drizzle-install-db.js";

export {
  runAppMigrations,
  SchemaMigratorError,
  type RunAppMigrationsArgs,
  type RunAppMigrationsResult,
  type AppMigrationRecord,
} from "./schema-migrator.js";

export {
  registerAppAgents,
  registerAgentsFromDefinition,
  AgentRegistrarError,
  type RegisterAppAgentsArgs,
  type RegisterAppAgentsResult,
  type RegisteredAgent,
} from "./agent-registrar.js";

export {
  registerAppWorkflows,
  registerWorkflowsFromDefinition,
  WorkflowRegistrarError,
  type RegisterAppWorkflowsArgs,
  type RegisterAppWorkflowsResult,
  type RegisteredWorkflow,
  type WorkflowTriggerSpec,
} from "./workflow-registrar.js";

export {
  createAppRouteRegistry,
  registerAppRoutes,
  unregisterAppRoutes,
  type AppRouteRegistry,
  type CreateAppRouteRegistryOptions,
  type InstallAppRoutesArgs,
  type InstalledRouteMount,
  type ApiCatalogEntry,
  type AgentDocs,
} from "./route-registrar.js";

export {
  createLifecycleContext,
  invokeOnTenantCreated,
  type CreateLifecycleContextArgs,
} from "./lifecycle.js";

export {
  createActionContext,
  type ActionEventBus,
  type CreateActionContextArgs,
} from "./action-context.js";

export {
  createDrizzleUninstallDb,
  type DrizzleUninstallDbOptions,
} from "./drizzle-uninstall-db.js";

export {
  createKernelInstallContext,
  type KernelInstallContext,
  type KernelInstallContextOptions,
  type KernelInstallArgs,
  type KernelUninstallArgs,
} from "./kernel-install-context.js";

export {
  loadCatalogFromDisk,
  loadCatalogStrict,
  CatalogLoaderError,
  type LoadCatalogOptions,
  type LoadCatalogResult,
  type CatalogLoaderEntryError,
} from "./disk-catalog.js";

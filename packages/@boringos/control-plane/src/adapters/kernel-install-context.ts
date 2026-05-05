// SPDX-License-Identifier: BUSL-1.1
//
// K7 — kernel install context.
//
// Composes K1-K6 into the InstallContext shape that C5's install
// pipeline expects, plus a higher-level `installApp` that wraps the
// whole sequence (row + schema + agents + workflows + routes +
// onTenantCreated) inside a single Drizzle transaction.
//
// The composed `installApp(args, definition)` calls C5's install
// pipeline directly inside the transaction so the contract is
// preserved end-to-end: validation, idempotent re-install, slot
// registration, event emit. K2-K4 run before C5's pipeline (so K3
// can be rolled back); K6 runs after (so seed code sees a fully
// installed app).

import type { AppDefinition, AppManifest, Manifest, UIDefinition } from "@boringos/app-sdk";

import type { Db } from "@boringos/db";

import {
  installApp as runC5Install,
  type InstallArgs,
  type InstallContext,
  type InstallEventBus,
  type InstallRecord,
  type SlotInstallRuntime,
  InstallError,
} from "../install.js";
import {
  uninstallApp as runC5Uninstall,
  type UninstallArgs,
  type UninstallContext,
  type UninstallResult,
} from "../uninstall.js";

import {
  createDrizzleInstallDb,
  type DrizzleInstallDb,
} from "./drizzle-install-db.js";
import {
  createDrizzleUninstallDb,
  type DrizzleUninstallDbOptions,
} from "./drizzle-uninstall-db.js";
import { runAppMigrations } from "./schema-migrator.js";
import { registerAgentsFromDefinition } from "./agent-registrar.js";
import { registerWorkflowsFromDefinition } from "./workflow-registrar.js";
import {
  createAppRouteRegistry,
  type AppRouteRegistry,
  type ApiCatalogEntry,
} from "./route-registrar.js";
import {
  createLifecycleContext,
  invokeOnTenantCreated,
} from "./lifecycle.js";

export interface KernelInstallContextOptions {
  /** Root Drizzle handle. The kernel ctx wraps the install in a tx on it. */
  db: Db;

  /**
   * Shell-side InstallRuntime singleton. K7 calls `installApp({appId,
   * version, ui})` on it after schema/agents/workflows/routes land,
   * so the slot registry stays the singleton from A6.
   */
  slotRuntime: SlotInstallRuntime;

  /**
   * Framework event bus. The "app.installed" event is emitted
   * post-commit; failures here are advisory (consistent with C5).
   */
  events: InstallEventBus;

  /**
   * Optional pre-built route registry. When omitted, K7 creates a
   * fresh one. The framework typically passes the singleton it
   * mounted on the core Hono app at boot.
   */
  routeRegistry?: AppRouteRegistry;

  /**
   * Optional hard-delete callback for the uninstall pipeline. When set,
   * `uninstallApp({ mode: "hard" })` invokes it after slot unregistration
   * and before the row is deleted.
   */
  hardDeleteAppData?: DrizzleUninstallDbOptions["hardDeleteAppData"];
}

export interface KernelInstallArgs extends InstallArgs {
  /** AppDefinition exported by the bundle — drives K3/K4/K5/K6. */
  definition: AppDefinition;

  /**
   * Filesystem path to the bundle directory the manifest lives in.
   * Used to resolve `manifest.schema` for K2's migration runner. May
   * be omitted when the manifest declares no schema.
   */
  bundleDir?: string;
}

export interface KernelUninstallArgs extends UninstallArgs {}

export interface KernelInstallContext {
  /**
   * Drizzle-backed install pipeline DB exposed for the rare caller
   * that wants to interact with `tenant_apps` outside the install
   * pipeline. Most callers use `installApp` instead.
   */
  readonly db: DrizzleInstallDb;

  /** The route registry the kernel ctx writes to during install. */
  readonly routeRegistry: AppRouteRegistry;

  /** Run a full atomic install (row + schema + agents + workflows + routes + onTenantCreated). */
  installApp(args: KernelInstallArgs): Promise<InstallRecord>;

  /** Reverse install. Calls C5's uninstall pipeline + drops route mount. */
  uninstallApp(args: KernelUninstallArgs): Promise<UninstallResult>;

  /** Snapshot of the api-catalog entries (for the agent engine's apiCatalog provider). */
  getApiCatalog(): ApiCatalogEntry[];
}

export function createKernelInstallContext(
  options: KernelInstallContextOptions,
): KernelInstallContext {
  const drizzleDb = createDrizzleInstallDb(options.db);
  const routeRegistry =
    options.routeRegistry ?? createAppRouteRegistry();

  async function installApp(args: KernelInstallArgs): Promise<InstallRecord> {
    const { definition, bundleDir, ...installArgs } = args;

    // Side-effect bookkeeping for rollback if the tx (or any
    // post-commit step) throws.
    let mountedAppId: string | null = null;
    let bufferedEvent: { type: string; payload: Record<string, unknown> } | null =
      null;

    try {
      const record = await drizzleDb.transaction(async (txDb, tx) => {
        // The C5 pipeline does its own validation; we let it do that
        // first by short-circuiting K2-K4 if validation fails. To
        // honor that ordering and still keep K2-K6 in the same tx,
        // we bind a per-tx C5 context and run the schema/agents/
        // workflows registrations *between* C5's validate-and-row
        // step and its slot/event step.
        //
        // Achieved by wiring a slotRuntime proxy that, when invoked
        // by the C5 pipeline, runs K2-K6 and then forwards to the
        // real slotRuntime. The route registry mount and ui register
        // happen synchronously inside the proxy so the slot+route
        // contributions are visible the moment the tx commits.
        const tenantId = installArgs.tenantId;
        const manifest = installArgs.manifest as Manifest;

        const slotProxy: SlotInstallRuntime = {
          installApp: (a) => {
            // We can't await here (slotRuntime.installApp is sync),
            // but K2-K4 + K6 need awaits. Resolve by performing the
            // async work via a queued promise the outer transaction
            // blocks on after the C5 pipeline returns. (Below.)
            // For now, capture the args for the post-pipeline phase.
            slotProxyCalls.push({ kind: "install", args: a });
            return { appId: a.appId };
          },
          uninstallApp: (id) => {
            slotProxyCalls.push({ kind: "uninstall", id });
          },
        };
        const slotProxyCalls: Array<
          | { kind: "install"; args: { appId: string; version: string; ui?: UIDefinition } }
          | { kind: "uninstall"; id: string }
        > = [];

        const eventProxy: InstallEventBus = {
          emit: (type, payload) => {
            bufferedEvent = { type, payload };
          },
        };

        const c5ctx: InstallContext = {
          db: txDb,
          slotRuntime: slotProxy,
          events: eventProxy,
        };

        // 1. C5 install — runs validation + insertTenantApp +
        //    slotProxy.installApp (capture only) + eventProxy.emit
        //    (capture only).
        const c5Record = await runC5Install(c5ctx, installArgs);

        // 2. K2 — schema migrations.
        if (manifest.kind === "app") {
          await runAppMigrations(tx, {
            tenantId,
            app: manifest as AppManifest,
            bundleDir,
          });
        }

        // 3. K3 — agents.
        await registerAgentsFromDefinition(
          tx,
          tenantId,
          manifest.id,
          definition,
        );

        // 4. K4 — workflows.
        await registerWorkflowsFromDefinition(
          tx,
          tenantId,
          manifest.id,
          definition,
        );

        // 5. K5 — routes (in-memory, but mount BEFORE onTenantCreated
        //    so seed code observing the route catalog sees the new
        //    app's mount).
        for (const call of slotProxyCalls) {
          if (call.kind === "install") {
            // K5: routes
            routeRegistry.installAppRoutes({
              appId: call.args.appId,
              definition,
            });
            mountedAppId = call.args.appId;
            // A6 InstallRuntime: slot UI register
            options.slotRuntime.installApp(call.args);
          } else {
            routeRegistry.uninstallAppRoutes(call.id);
            options.slotRuntime.uninstallApp(call.id);
          }
        }

        // 6. K6 — onTenantCreated.
        const lifecycleCtx = createLifecycleContext({ tx, tenantId });
        await invokeOnTenantCreated(definition, lifecycleCtx);

        return c5Record;
      });

      // Tx committed — emit the buffered event (advisory; failures swallowed).
      if (bufferedEvent !== null) {
        const buffered: { type: string; payload: Record<string, unknown> } = bufferedEvent;
        try {
          await options.events.emit(buffered.type, buffered.payload);
        } catch {
          // Event bus is fault-tolerant; consistent with C5 behavior.
        }
      }

      return record;
    } catch (err) {
      // Tx rolled back. Undo any in-memory side effects we performed
      // before the failure. The route registry / slot runtime are
      // idempotent on uninstall, so calling them blindly is safe.
      if (mountedAppId) {
        try {
          routeRegistry.uninstallAppRoutes(mountedAppId);
        } catch {
          // best-effort
        }
        try {
          options.slotRuntime.uninstallApp(mountedAppId);
        } catch {
          // best-effort
        }
      }
      throw err;
    }
  }

  const uninstallDb = createDrizzleUninstallDb(options.db, {
    hardDeleteAppData: options.hardDeleteAppData,
  });

  async function uninstallApp(
    args: KernelUninstallArgs,
  ): Promise<UninstallResult> {
    // C5's uninstall does the row delete + slot.uninstallApp + event.
    // For routes we drop the in-memory mount so /api/{appId}/* 404s
    // immediately. App-owned schema teardown is out of scope for v1
    // (matches the K2 contract: the migrator owns creation, callers
    // own teardown).
    const c5ctx: UninstallContext = {
      db: uninstallDb,
      slotRuntime: options.slotRuntime,
      events: options.events,
    };
    const result = await runC5Uninstall(c5ctx, args);
    if (result.uninstalled) {
      try {
        routeRegistry.uninstallAppRoutes(args.appId);
      } catch {
        // best-effort
      }
    }
    return result;
  }

  return {
    db: drizzleDb,
    routeRegistry,
    installApp,
    uninstallApp,
    getApiCatalog: () => routeRegistry.getCatalog(),
  };
}

export { InstallError };

import { generateId } from "@boringos/shared";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { nullMemory } from "@boringos/memory";
import type { MemoryProvider } from "@boringos/memory";
import {
  createRuntimeRegistry,
  claudeRuntime,
  chatgptRuntime,
  geminiRuntime,
  ollamaRuntime,
  commandRuntime,
  webhookRuntime,
} from "@boringos/runtime";
import type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
import { createLocalStorage, scaffoldDrive } from "@boringos/drive";
import type { StorageBackend } from "@boringos/drive";
import { createDatabase, createMigrationManager } from "@boringos/db";
import type { Db, DatabaseConnection } from "@boringos/db";
import { createAgentEngine, ContextPipeline } from "@boringos/agent";
import type { AgentEngine, ContextProvider, AgentRunJob } from "@boringos/agent";
import type { QueueAdapter } from "@boringos/pipeline";
import {
  createWorkflowEngine,
  createWorkflowStore,
  createHandlerRegistry,
  triggerHandler,
  conditionHandler,
  delayHandler,
  transformHandler,
} from "@boringos/workflow";
import type { WorkflowEngine, BlockHandler } from "@boringos/workflow";
import {
  createConnectorRegistry,
  createEventBus,
  createActionRunner,
} from "@boringos/connector";
import type { ConnectorDefinition as ConnectorDef } from "@boringos/connector";
import type {
  BoringOSConfig,
  AppContext,
  ConnectorDefinition,
  PersonaBundle,
  PluginManifest,
  LifecycleHook,
  StartedServer,
} from "./types.js";
import { createCallbackRoutes } from "./routes.js";
import { createConnectorRoutes } from "./connector-routes.js";
import { createAdminRoutes } from "./admin-routes.js";
import { createRealtimeBus } from "./realtime.js";
import type { RealtimeBus } from "./realtime.js";
import { createSSERoutes } from "./sse-routes.js";
import { bootstrapAuthTables } from "./auth.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createDeviceAuthRoutes } from "./device-auth-routes.js";
import { createRoutineScheduler } from "./scheduler.js";
import { createPluginRegistry } from "./plugin-system.js";
import type { PluginDefinition } from "./plugin-system.js";
import { createPluginWebhookRoutes, createPluginAdminRoutes } from "./plugin-routes.js";
import { githubPlugin } from "./plugins/github.js";

export class BoringOS {
  private config: BoringOSConfig;
  private memoryProvider: MemoryProvider = nullMemory;
  private extraRuntimes: RuntimeModule[] = [];
  private contextProviders: ContextProvider[] = [];
  private personas: Map<string, PersonaBundle> = new Map();
  private plugins: PluginManifest[] = [];
  private pluginDefs: PluginDefinition[] = [];
  private connectorDefs: ConnectorDef[] = [];
  private beforeStartHooks: LifecycleHook[] = [];
  private afterStartHooks: LifecycleHook[] = [];
  private beforeShutdownHooks: LifecycleHook[] = [];
  private extraRoutes: Array<{ path: string; app: Hono }> = [];
  private blockHandlers: BlockHandler[] = [];
  private queueAdapter: QueueAdapter<AgentRunJob> | undefined;
  private userSchemaStatements: string[] = [];
  private inboxRoutes: Array<{ filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string } }> = [];

  constructor(config: BoringOSConfig = {}) {
    this.config = config;
  }

  memory(provider: MemoryProvider): this {
    this.memoryProvider = provider;
    return this;
  }

  runtime(module: RuntimeModule): this {
    this.extraRuntimes.push(module);
    return this;
  }

  contextProvider(provider: ContextProvider): this {
    this.contextProviders.push(provider);
    return this;
  }

  persona(role: string, bundle: PersonaBundle): this {
    this.personas.set(role, bundle);
    return this;
  }

  connector(definition: ConnectorDef): this {
    this.connectorDefs.push(definition);
    return this;
  }

  plugin(manifest: PluginManifest | PluginDefinition): this {
    if ("jobs" in manifest || "webhooks" in manifest) {
      this.pluginDefs.push(manifest as PluginDefinition);
    } else {
      this.plugins.push(manifest as PluginManifest);
    }
    return this;
  }

  queue(adapter: QueueAdapter<AgentRunJob>): this {
    this.queueAdapter = adapter;
    return this;
  }

  schema(ddlStatements: string | string[]): this {
    const stmts = Array.isArray(ddlStatements) ? ddlStatements : [ddlStatements];
    this.userSchemaStatements.push(...stmts);
    return this;
  }

  routeToInbox(config: { filter: (event: Record<string, unknown>) => boolean; transform: (event: Record<string, unknown>) => { source: string; subject: string; body?: string; from?: string } }): this {
    this.inboxRoutes.push(config);
    return this;
  }

  blockHandler(handler: BlockHandler): this {
    this.blockHandlers.push(handler);
    return this;
  }

  beforeStart(fn: LifecycleHook): this {
    this.beforeStartHooks.push(fn);
    return this;
  }

  afterStart(fn: LifecycleHook): this {
    this.afterStartHooks.push(fn);
    return this;
  }

  beforeShutdown(fn: LifecycleHook): this {
    this.beforeShutdownHooks.push(fn);
    return this;
  }

  route(path: string, app: Hono): this {
    this.extraRoutes.push({ path, app });
    return this;
  }

  async listen(port?: number): Promise<StartedServer> {
    const listenPort = port ?? 3000;

    // 1. Boot database
    const dbConfig = this.config.database ?? { embedded: true as const };
    const dbConn = await createDatabase(dbConfig);

    // 2. Run migrations
    const migrator = createMigrationManager(dbConn.db);
    await migrator.apply();

    // 2b. Bootstrap auth tables
    await bootstrapAuthTables(dbConn.db);

    // 2c. Apply user schema DDL
    if (this.userSchemaStatements.length > 0) {
      const { sql: rawSql } = await import("drizzle-orm");
      for (const stmt of this.userSchemaStatements) {
        await dbConn.db.execute(rawSql.raw(stmt));
      }
    }

    // 3. Initialize drive
    const driveRoot = this.config.drive?.root ?? "./.data/drive";
    const drive = this.config.drive?.backend ?? createLocalStorage({ root: driveRoot });

    // 4. Build runtime registry
    const runtimes = createRuntimeRegistry();
    for (const rt of [claudeRuntime, chatgptRuntime, geminiRuntime, ollamaRuntime, commandRuntime, webhookRuntime]) {
      runtimes.register(rt);
    }
    for (const rt of this.extraRuntimes) {
      runtimes.register(rt);
    }

    // 5. Build context pipeline
    const pipeline = new ContextPipeline();
    for (const provider of this.contextProviders) {
      pipeline.add(provider);
    }

    // 6. Create agent engine
    const jwtSecret = this.config.auth?.secret ?? "boringos-dev-secret";
    const callbackUrl = `http://localhost:${listenPort}`;

    const agentEngine = createAgentEngine({
      db: dbConn.db,
      runtimes,
      memory: this.memoryProvider,
      drive,
      pipeline,
      callbackUrl,
      jwtSecret,
      queue: this.queueAdapter,
    });

    // 7. Build workflow engine
    const handlerRegistry = createHandlerRegistry();
    handlerRegistry.register(triggerHandler);
    handlerRegistry.register(conditionHandler);
    handlerRegistry.register(delayHandler);
    handlerRegistry.register(transformHandler);
    for (const handler of this.blockHandlers) {
      handlerRegistry.register(handler);
    }

    const workflowStore = createWorkflowStore(dbConn.db);
    const memoryRef = this.memoryProvider;
    const workflowEngine = createWorkflowEngine({
      store: workflowStore,
      handlers: handlerRegistry,
      services: {
        get<T>(key: string): T | undefined {
          const map: Record<string, unknown> = { db: dbConn.db, memory: memoryRef, drive, agentEngine };
          return map[key] as T | undefined;
        },
        has(key: string): boolean {
          return ["db", "memory", "drive", "agentEngine"].includes(key);
        },
      },
    });

    // 8. Build app context
    const context: AppContext = {
      config: this.config,
      db: dbConn.db,
      memory: this.memoryProvider,
      drive,
      runtimes,
      agentEngine,
      workflowEngine,
    };

    // 8. Run beforeStart hooks
    for (const hook of this.beforeStartHooks) {
      await hook(context);
    }

    // 9. Setup plugins
    for (const plugin of this.plugins) {
      await plugin.setup(context);
    }

    // 9b. Setup plugin system
    const pluginRegistry = createPluginRegistry();
    pluginRegistry.register(githubPlugin); // built-in
    for (const def of this.pluginDefs) {
      pluginRegistry.register(def);
    }

    // 10. Setup connectors
    const connectorRegistry = createConnectorRegistry();
    const eventBus = createEventBus();
    for (const def of this.connectorDefs) {
      connectorRegistry.register(def);
    }
    const actionRunner = createActionRunner(connectorRegistry);

    // Wire connector events to agent wakeups + inbox routing
    eventBus.onAny(async (event) => {
      // Route events to inbox based on configured routes
      for (const route of this.inboxRoutes) {
        if (route.filter(event as unknown as Record<string, unknown>)) {
          const item = route.transform(event as unknown as Record<string, unknown>);
          const { inboxItems } = await import("@boringos/db");
          await dbConn.db.insert(inboxItems).values({
            id: generateId(),
            tenantId: event.tenantId,
            source: item.source,
            subject: item.subject,
            body: item.body ?? null,
            from: item.from ?? null,
          }).catch(() => {});
        }
      }
    });

    // 11. Build Hono app
    const app = new Hono();

    // Health endpoint
    app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

    // Auth routes (login, signup, session)
    const authApp = createAuthRoutes(dbConn.db, jwtSecret);
    app.route("/api/auth", authApp);

    // Device auth routes (CLI login)
    const deviceAuthApp = createDeviceAuthRoutes(dbConn.db);
    app.route("/api/auth/device", deviceAuthApp);

    // Agent callback API
    const callbackApp = createCallbackRoutes(dbConn.db, agentEngine, jwtSecret);
    app.route("/api/agent", callbackApp);

    // Connector routes
    const connectorApp = createConnectorRoutes(dbConn.db, connectorRegistry, eventBus, actionRunner, jwtSecret);
    app.route("/api/connectors", connectorApp);

    // Admin API (for human management of the platform)
    const adminKeyValue = this.config.auth?.adminKey ?? jwtSecret;
    // Realtime SSE
    const realtimeBus = createRealtimeBus();

    const adminApp = createAdminRoutes(dbConn.db, agentEngine, adminKeyValue, realtimeBus);
    app.route("/api/admin", adminApp);
    const sseApp = createSSERoutes(realtimeBus, adminKeyValue);
    app.route("/api", sseApp);

    // Wire engine events to realtime bus
    agentEngine.beforeRun.use((event) => {
      realtimeBus.publish({
        type: "run:started",
        tenantId: event.tenantId,
        data: { runId: event.runId, agentId: event.agentId, taskId: event.taskId },
        timestamp: new Date().toISOString(),
      });
    });
    agentEngine.afterRun.use((event) => {
      const status = event.result.exitCode === 0 ? "run:completed" : "run:failed";
      realtimeBus.publish({
        type: status,
        tenantId: event.tenantId,
        data: { runId: event.runId, agentId: event.agentId, exitCode: event.result.exitCode },
        timestamp: new Date().toISOString(),
      });
    });

    // Plugin webhook routes
    const pluginWebhookApp = createPluginWebhookRoutes(dbConn.db, pluginRegistry);
    app.route("/webhooks/plugins", pluginWebhookApp);

    // Plugin admin routes (under admin API auth)
    const pluginAdminApp = createPluginAdminRoutes(dbConn.db, pluginRegistry);
    app.route("/api/admin/plugins", pluginAdminApp);

    // Extra routes
    for (const { path, app: routeApp } of this.extraRoutes) {
      app.route(path, routeApp);
    }

    // 11. Start HTTP server
    const server = serve({ fetch: app.fetch, port: listenPort });

    // Get the actual port (important when listenPort is 0)
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : listenPort;

    // 12. Start routine scheduler
    const scheduler = createRoutineScheduler(dbConn.db, agentEngine);
    scheduler.start();

    // 13. Run afterStart hooks
    for (const hook of this.afterStartHooks) {
      await hook(context);
    }

    const url = `http://localhost:${actualPort}`;

    return {
      url,
      port: actualPort,
      context,
      async close() {
        scheduler.stop();
        server.close();
        await dbConn.close();
      },
    };
  }
}

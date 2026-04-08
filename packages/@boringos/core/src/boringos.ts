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

export class BoringOS {
  private config: BoringOSConfig;
  private memoryProvider: MemoryProvider = nullMemory;
  private extraRuntimes: RuntimeModule[] = [];
  private contextProviders: ContextProvider[] = [];
  private personas: Map<string, PersonaBundle> = new Map();
  private plugins: PluginManifest[] = [];
  private connectorDefs: ConnectorDef[] = [];
  private beforeStartHooks: LifecycleHook[] = [];
  private afterStartHooks: LifecycleHook[] = [];
  private beforeShutdownHooks: LifecycleHook[] = [];
  private extraRoutes: Array<{ path: string; app: Hono }> = [];
  private blockHandlers: BlockHandler[] = [];
  private queueAdapter: QueueAdapter<AgentRunJob> | undefined;

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

  plugin(manifest: PluginManifest): this {
    this.plugins.push(manifest);
    return this;
  }

  queue(adapter: QueueAdapter<AgentRunJob>): this {
    this.queueAdapter = adapter;
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

    // 10. Setup connectors
    const connectorRegistry = createConnectorRegistry();
    const eventBus = createEventBus();
    for (const def of this.connectorDefs) {
      connectorRegistry.register(def);
    }
    const actionRunner = createActionRunner(connectorRegistry);

    // Wire connector events to agent wakeups
    eventBus.onAny(async (event) => {
      // Connector events can trigger agent wakeups via the "connector_event" reason
      // Consumers can add custom routing via eventBus.on()
    });

    // 11. Build Hono app
    const app = new Hono();

    // Health endpoint
    app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

    // Agent callback API
    const callbackApp = createCallbackRoutes(dbConn.db, agentEngine, jwtSecret);
    app.route("/api/agent", callbackApp);

    // Connector routes
    const connectorApp = createConnectorRoutes(dbConn.db, connectorRegistry, eventBus, actionRunner, jwtSecret);
    app.route("/api/connectors", connectorApp);

    // Extra routes
    for (const { path, app: routeApp } of this.extraRoutes) {
      app.route(path, routeApp);
    }

    // 11. Start HTTP server
    const server = serve({ fetch: app.fetch, port: listenPort });

    // Get the actual port (important when listenPort is 0)
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : listenPort;

    // 12. Run afterStart hooks
    for (const hook of this.afterStartHooks) {
      await hook(context);
    }

    const url = `http://localhost:${actualPort}`;

    return {
      url,
      port: actualPort,
      context,
      async close() {
        server.close();
        await dbConn.close();
      },
    };
  }
}

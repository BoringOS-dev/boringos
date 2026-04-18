import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents, agentRuntimeState, agentWakeupRequests, agentRuns, costEvents, tenantSettings } from "@boringos/db";
import type { MemoryProvider } from "@boringos/memory";
import type { RuntimeRegistry, AgentRunCallbacks, CostEvent } from "@boringos/runtime";
import type { StorageBackend } from "@boringos/drive";
import type { QueueAdapter } from "@boringos/pipeline";
import { createInProcessQueue } from "@boringos/pipeline";
import { createHook, generateId } from "@boringos/shared";
import type { Hook } from "@boringos/shared";
import type {
  AgentEngine,
  WakeRequest,
  WakeupOutcome,
  BeforeRunEvent,
  ContextBuildEvent,
  AfterRunEvent,
  RunErrorEvent,
  AgentRunJob,
} from "./types.js";
import { ContextPipeline } from "./context-pipeline.js";
import { signCallbackToken } from "./jwt.js";
import { createWakeup } from "./wakeup.js";
import { createRunLifecycle } from "./run-lifecycle.js";
import {
  headerProvider,
  personaProvider,
  memorySkillProvider,
  agentInstructionsProvider,
  protocolProvider,
  sessionProvider,
  memoryContextProvider,
  createTenantGuidelinesProvider,
  createDriveSkillProvider,
  createTaskProvider,
  createCommentsProvider,
  createApprovalProvider,
  createHierarchyProvider,
  createApiCatalogProvider,
  type ApiCatalogEntry,
  chiefOfStaffProvider,
} from "./providers/index.js";

export interface AgentEngineConfig {
  db: Db;
  runtimes: RuntimeRegistry;
  memory: MemoryProvider | null;
  drive: StorageBackend | null;
  pipeline: ContextPipeline;
  callbackUrl: string;
  jwtSecret: string;
  queue?: QueueAdapter<AgentRunJob>;
  /**
   * App-registered HTTP mounts with agent-facing docs. Accepts a getter so
   * the catalog can be resolved at prompt-build time — important when apps
   * register routes in `beforeStart` hooks that run after engine creation.
   * A built-in context provider emits these into every agent's system prompt.
   */
  apiCatalog?: ApiCatalogEntry[] | (() => ApiCatalogEntry[]);
}

function registerDefaultProviders(pipeline: ContextPipeline, config: AgentEngineConfig): void {
  // System instruction providers
  pipeline.add(headerProvider);
  pipeline.add(createHierarchyProvider({ db: config.db }));
  pipeline.add(personaProvider);
  pipeline.add(createTenantGuidelinesProvider({ db: config.db }));
  pipeline.add(chiefOfStaffProvider);
  pipeline.add(createDriveSkillProvider({ drive: config.drive }));
  pipeline.add(memorySkillProvider);
  pipeline.add(agentInstructionsProvider);
  pipeline.add(protocolProvider);
  if (config.apiCatalog) {
    pipeline.add(createApiCatalogProvider(config.apiCatalog));
  }

  // Context markdown providers
  pipeline.add(sessionProvider);
  pipeline.add(createTaskProvider({ db: config.db }));
  pipeline.add(createCommentsProvider({ db: config.db }));
  pipeline.add(memoryContextProvider);
  pipeline.add(createApprovalProvider({ db: config.db }));
}

export function createAgentEngine(config: AgentEngineConfig): AgentEngine {
  const { db, runtimes, memory, pipeline, callbackUrl, jwtSecret } = config;
  const lifecycle = createRunLifecycle(db);

  // Register built-in providers (users' custom providers were already added to pipeline)
  registerDefaultProviders(pipeline, config);

  const beforeRun: Hook<BeforeRunEvent> = createHook();
  const buildContext: Hook<ContextBuildEvent> = createHook();
  const afterRun: Hook<AfterRunEvent> = createHook();
  const onCost: Hook<CostEvent> = createHook();
  const onError: Hook<RunErrorEvent> = createHook();

  // Queue adapter — defaults to in-process if none provided
  const queue = config.queue ?? createInProcessQueue<AgentRunJob>();

  // Register job processor
  queue.process(async (job) => {
    try {
      await executeJob(job);
    } catch (err) {
      await onError.run({
        agentId: job.agentId,
        tenantId: job.tenantId,
        runId: "",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  });

  async function executeJob(job: AgentRunJob): Promise<void> {
    // Fetch agent
    const agentRows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, job.agentId), eq(agents.tenantId, job.tenantId)))
      .limit(1);

    const agent = agentRows[0];
    if (!agent) return;

    // Create run record
    const runId = await lifecycle.create({
      agentId: job.agentId,
      tenantId: job.tenantId,
      wakeupRequestId: job.wakeupRequestId,
      taskId: job.taskId,
    });

    await lifecycle.updateStatus(runId, "running");

    // Global agent pause check
    const pauseRows = await db.select().from(tenantSettings).where(
      and(eq(tenantSettings.tenantId, job.tenantId), eq(tenantSettings.key, "agents_paused")),
    ).limit(1);
    if (pauseRows[0]?.value === "true") {
      await lifecycle.updateStatus(runId, "skipped", { error: "All agents are paused for this tenant", errorCode: "agents_paused" });
      return;
    }

    // Per-agent pause check
    if (agent.status === "paused") {
      await lifecycle.updateStatus(runId, "skipped", { error: `Agent "${agent.name}" is paused`, errorCode: "agent_paused" });
      return;
    }

    // Budget check
    const { checkBudget } = await import("./budget.js");
    const budgetResult = await checkBudget(db, job.tenantId, job.agentId);
    if (!budgetResult.allowed) {
      await lifecycle.updateStatus(runId, "failed", { error: budgetResult.reason, errorCode: "budget_exceeded" });
      return;
    }

    // Fire beforeRun hooks
    await beforeRun.run({ agentId: job.agentId, tenantId: job.tenantId, runId, taskId: job.taskId });

    // Get previous session state
    const stateRows = await db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, job.agentId))
      .limit(1);
    const previousState = stateRows[0];

    // Generate signed callback JWT (4-hour expiry)
    const callbackToken = signCallbackToken(
      { runId, agentId: job.agentId, tenantId: job.tenantId },
      jwtSecret,
    );

    // Build context
    const contextEvent: ContextBuildEvent = {
      agent: {
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        role: agent.role,
        title: agent.title,
        icon: agent.icon,
        status: agent.status as "idle" | "running" | "paused" | "error" | "archived",
        reportsTo: agent.reportsTo,
        instructions: agent.instructions,
        runtimeId: agent.runtimeId,
        fallbackRuntimeId: agent.fallbackRuntimeId,
        budgetMonthlyCents: agent.budgetMonthlyCents,
        spentMonthlyCents: agent.spentMonthlyCents,
        pauseReason: agent.pauseReason,
        pausedAt: agent.pausedAt,
        permissions: agent.permissions as Record<string, unknown>,
        metadata: agent.metadata as Record<string, unknown> | null,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      },
      tenantId: job.tenantId,
      runId,
      taskId: job.taskId,
      wakeReason: job.wakeReason,
      memory,
      previousSessionId: previousState?.sessionId ?? undefined,
      previousSessionSummary: (previousState?.stateJson as Record<string, string> | null)?.sessionSummary ?? undefined,
      callbackUrl,
      callbackToken,
    };

    await buildContext.run(contextEvent);

    const { systemInstructions, contextMarkdown } = await pipeline.build(contextEvent);

    // Resolve runtime — look up from DB if agent has a runtimeId, else default to claude
    let runtimeType = "claude";
    let runtimeConfig: Record<string, unknown> = {};
    if (agent.runtimeId) {
      const { runtimes: runtimesTable } = await import("@boringos/db");
      const rtRows = await db.select().from(runtimesTable).where(eq(runtimesTable.id, agent.runtimeId)).limit(1);
      if (rtRows[0]) {
        runtimeType = rtRows[0].type;
        runtimeConfig = (rtRows[0].config as Record<string, unknown>) ?? {};
        if (rtRows[0].model && !runtimeConfig.model) {
          runtimeConfig.model = rtRows[0].model;
        }
      }
    }
    const runtime = runtimes.get(runtimeType);
    if (!runtime) {
      await lifecycle.updateStatus(runId, "failed", { error: `No runtime found for type: ${runtimeType}` });
      return;
    }

    // Execute runtime
    let lastModel: string | undefined;

    const callbacks: AgentRunCallbacks = {
      async onOutputLine(line) {
        await lifecycle.appendLog(runId, line);
      },
      async onStderrLine(line) {
        await lifecycle.appendStderr(runId, line);
      },
      onCostEvent(event) {
        onCost.run(event);
        lastModel = event.model;
        db.insert(costEvents).values({
          id: generateId(),
          tenantId: job.tenantId,
          agentId: job.agentId,
          runId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          model: event.model,
          costUsd: event.costUsd?.toString(),
        }).catch(() => {});
      },
      onComplete(result) {
        lifecycle.updateStatus(runId, result.exitCode === 0 ? "done" : "failed", {
          exitCode: result.exitCode,
          sessionId: result.sessionId,
        });

        // Persist model used on the run record
        const runModel = lastModel ?? (runtimeConfig.model as string | undefined);
        if (runModel) {
          db.update(agentRuns).set({ model: runModel, updatedAt: new Date() } as Record<string, unknown>)
            .where(eq(agentRuns.id, runId)).catch(() => {});
        }

        // Update wakeup status
        if (job.wakeupRequestId) {
          db.update(agentWakeupRequests)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(agentWakeupRequests.id, job.wakeupRequestId))
            .catch(() => {});
        }

        // Persist session state
        if (result.sessionId) {
          const stateValues = {
            agentId: job.agentId,
            tenantId: job.tenantId,
            sessionId: result.sessionId,
            stateJson: { sessionSummary: result.summary },
            updatedAt: new Date(),
          };

          if (previousState) {
            db.update(agentRuntimeState)
              .set(stateValues)
              .where(eq(agentRuntimeState.agentId, job.agentId))
              .catch(() => {});
          } else {
            db.insert(agentRuntimeState)
              .values({ id: generateId(), ...stateValues })
              .catch(() => {});
          }
        }
      },
      onError(error) {
        lifecycle.updateStatus(runId, "failed", { error: error.message });
        onError.run({ agentId: job.agentId, tenantId: job.tenantId, runId, error });
      },
    };

    try {
      const result = await runtime.execute(
        {
          runId,
          agentId: job.agentId,
          tenantId: job.tenantId,
          taskId: job.taskId,
          wakeReason: job.wakeReason,
          config: runtimeConfig,
          systemInstructions,
          contextMarkdown,
          callbackUrl,
          callbackToken,
          previousSessionId: previousState?.sessionId ?? undefined,
        },
        callbacks,
      );

      await afterRun.run({
        agentId: job.agentId,
        tenantId: job.tenantId,
        runId,
        taskId: job.taskId,
        result,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
    }
  }

  return {
    async wake(request: WakeRequest): Promise<WakeupOutcome> {
      return createWakeup(db, request);
    },

    async enqueue(wakeupId: string): Promise<string> {
      // Fetch wakeup request
      const rows = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, wakeupId))
        .limit(1);

      const wakeup = rows[0];
      if (!wakeup) throw new Error(`Wakeup request not found: ${wakeupId}`);

      const job: AgentRunJob = {
        wakeupRequestId: wakeup.id,
        agentId: wakeup.agentId,
        tenantId: wakeup.tenantId,
        wakeReason: wakeup.reason as AgentRunJob["wakeReason"],
        taskId: wakeup.taskId ?? undefined,
        payload: wakeup.payload as Record<string, unknown> | undefined,
      };

      await queue.enqueue(job);

      return wakeupId;
    },

    async cancel(runId: string): Promise<void> {
      await lifecycle.updateStatus(runId, "cancelled");
    },

    beforeRun,
    buildContext,
    afterRun,
    onCost,
    onError,
  };
}

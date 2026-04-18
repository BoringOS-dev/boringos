import type {
  WorkflowEngine,
  WorkflowStore,
  WorkflowRunResult,
  TriggerPayload,
  BlockHandlerContext,
  BlockHandlerResult,
  BlockState,
  ServiceAccessor,
  DAGNode,
  WorkflowDefinition,
  ExecutionState,
} from "./types.js";
import { buildDAG } from "./dag.js";
import { createExecutionState, resolveTemplate } from "./state.js";
import type { HandlerRegistry } from "./handler-registry.js";
import type { WorkflowRunStore, RunTriggerType } from "./run-store.js";
import { generateId } from "@boringos/shared";

/**
 * Event payload emitted by the engine at run / block lifecycle transitions.
 * Wired into the framework's RealtimeBus by boringos.ts so the web UI can
 * stream live updates via SSE instead of polling.
 */
export type WorkflowEvent =
  | { type: "run_started";     tenantId: string; workflowId: string; runId: string }
  | { type: "run_completed";   tenantId: string; workflowId: string; runId: string }
  | { type: "run_failed";      tenantId: string; workflowId: string; runId: string; error?: string }
  | { type: "run_paused";      tenantId: string; workflowId: string; runId: string; blockId: string; awaitingActionTaskId: string }
  | { type: "block_started";   tenantId: string; workflowId: string; runId: string; blockId: string; blockType: string }
  | { type: "block_completed"; tenantId: string; workflowId: string; runId: string; blockId: string; blockType: string; durationMs: number }
  | { type: "block_failed";    tenantId: string; workflowId: string; runId: string; blockId: string; blockType: string; error: string }
  | { type: "block_waiting";   tenantId: string; workflowId: string; runId: string; blockId: string; blockType: string }
  | { type: "block_skipped";   tenantId: string; workflowId: string; runId: string; blockId: string; blockType: string };

export interface WorkflowEngineConfig {
  store: WorkflowStore;
  handlers: HandlerRegistry;
  services: ServiceAccessor;
  /**
   * Optional persistence layer for run + block-run history. When provided,
   * every workflow execution writes one `workflow_runs` row plus one
   * `workflow_block_runs` row per block — lets the UI render run history,
   * live execution traces, and replay/debug views. If omitted, engine
   * behavior is unchanged and runs leave no trace (useful for tests).
   *
   * Resume (`engine.resume()`) requires a run store — without one there's
   * nothing to reload from.
   */
  runStore?: WorkflowRunStore;
  /**
   * Optional event sink — engine calls this on every run/block lifecycle
   * transition. Framework wires this to the RealtimeBus so SSE consumers
   * (the web UI's live DAG view) get pushed updates. Errors are swallowed
   * so a broken listener never kills a workflow.
   */
  onEvent?: (event: WorkflowEvent) => void;
}

export function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine {
  const { store, handlers, services, runStore, onEvent } = config;

  /** Dispatch an event to the configured sink, swallowing any errors. */
  function emit(event: WorkflowEvent): void {
    if (!onEvent) return;
    try { onEvent(event); } catch (err) { console.warn("[workflow] onEvent sink threw:", err); }
  }

  // ── Persistence helpers — swallow errors so a DB hiccup never kills a run ──

  async function safeCreateRun(input: Parameters<NonNullable<typeof runStore>["createRun"]>[0]): Promise<string | null> {
    if (!runStore) return null;
    try { return await runStore.createRun(input); } catch (err) { console.warn("[workflow] createRun failed:", err); return null; }
  }
  async function safeUpdateRun(id: string | null, input: Parameters<NonNullable<typeof runStore>["updateRun"]>[1]): Promise<void> {
    if (!runStore || !id) return;
    try { await runStore.updateRun(id, input); } catch (err) { console.warn("[workflow] updateRun failed:", err); }
  }
  async function safeCreateBlockRun(input: Parameters<NonNullable<typeof runStore>["createBlockRun"]>[0]): Promise<string | null> {
    if (!runStore) return null;
    try { return await runStore.createBlockRun(input); } catch (err) { console.warn("[workflow] createBlockRun failed:", err); return null; }
  }
  async function safeUpdateBlockRun(id: string | null, input: Parameters<NonNullable<typeof runStore>["updateBlockRun"]>[1]): Promise<void> {
    if (!runStore || !id) return;
    try { await runStore.updateBlockRun(id, input); } catch (err) { console.warn("[workflow] updateBlockRun failed:", err); }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Snapshot completed block outputs keyed by name — used as input context. */
  function snapshotState(state: ExecutionState, nameToId: Map<string, string>): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const [name, id] of nameToId) {
      const bs = state.get(id);
      if (bs?.status === "completed" && bs.output !== undefined) snap[name] = bs.output;
    }
    return snap;
  }

  /**
   * Core DAG walk. Processes `frontier` blocks until exhausted or until a
   * block requests pause. Returns the outcome.
   */
  async function walk(params: {
    workflowRunId: string | null;
    workflow: WorkflowDefinition;
    dag: ReturnType<typeof buildDAG>;
    nameToId: Map<string, string>;
    state: ExecutionState;
    completed: Set<string>;
    failed: Set<string>;
    blockResults: Map<string, BlockHandlerResult>;
    frontier: string[];
  }): Promise<{ kind: "done"; failed: Set<string> } | { kind: "paused"; blockId: string; taskId: string }> {
    const { workflow, dag, nameToId, state, completed, failed, blockResults } = params;
    let { frontier } = params;

    while (frontier.length > 0) {
      const nextFrontier: string[] = [];

      for (const blockId of frontier) {
        const node = dag.nodes.get(blockId);
        if (!node) continue;

        // All incoming deps must be resolved (completed or failed) before we run
        const allDependenciesMet = Array.from(node.incomingBlockIds).every(
          (depId) => completed.has(depId) || failed.has(depId),
        );
        if (!allDependenciesMet) {
          nextFrontier.push(blockId);
          continue;
        }

        // If any upstream failed, mark skipped and propagate
        const anyDepFailed = Array.from(node.incomingBlockIds).some((depId) => failed.has(depId));
        if (anyDepFailed) {
          state.set(blockId, { status: "skipped" });
          completed.add(blockId);
          const skippedId = await safeCreateBlockRun({
            workflowRunId: params.workflowRunId ?? "",
            tenantId: workflow.tenantId,
            blockId, blockName: node.name, blockType: node.type, status: "skipped",
          });
          await safeUpdateBlockRun(skippedId, { status: "skipped", error: "upstream block failed", finishedAt: new Date() });
          if (params.workflowRunId) emit({ type: "block_skipped", tenantId: workflow.tenantId, workflowId: workflow.id, runId: params.workflowRunId, blockId, blockType: node.type });
          continue;
        }

        const handler = handlers.get(node.type);
        if (!handler) {
          const err = `No handler for block type: ${node.type}`;
          state.set(blockId, { status: "failed", error: err });
          failed.add(blockId);
          const id = await safeCreateBlockRun({
            workflowRunId: params.workflowRunId ?? "",
            tenantId: workflow.tenantId,
            blockId, blockName: node.name, blockType: node.type, status: "failed",
          });
          await safeUpdateBlockRun(id, { status: "failed", error: err, finishedAt: new Date() });
          continue;
        }

        // Resolve config templates against completed state
        const resolvedConfig: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node.config)) {
          resolvedConfig[key] = typeof value === "string" ? resolveTemplate(value, state, nameToId) : value;
        }

        const blockStartedAt = new Date();
        state.set(blockId, { status: "running", startedAt: blockStartedAt });
        const blockRunId = await safeCreateBlockRun({
          workflowRunId: params.workflowRunId ?? "",
          tenantId: workflow.tenantId,
          blockId, blockName: node.name, blockType: node.type, status: "running",
        });
        const inputCtx = snapshotState(state, nameToId);
        await safeUpdateBlockRun(blockRunId, {
          status: "running",
          resolvedConfig,
          inputContext: inputCtx,
          startedAt: blockStartedAt,
        });
        if (params.workflowRunId) emit({ type: "block_started", tenantId: workflow.tenantId, workflowId: workflow.id, runId: params.workflowRunId, blockId, blockType: node.type });

        try {
          const ctx: BlockHandlerContext = {
            blockId,
            blockName: node.name,
            blockType: node.type,
            config: resolvedConfig,
            workflowRunId: params.workflowRunId ?? generateId(),
            workflowId: workflow.id,
            tenantId: workflow.tenantId,
            governingAgentId: workflow.governingAgentId,
            workflowType: workflow.type,
            state,
            services,
          };

          const result = await handler.execute(ctx);
          const blockFinishedAt = new Date();

          // Pause signal from a wait-for-human (or similar) block
          if (result.waitingForResume) {
            state.set(blockId, {
              status: "waiting",
              output: result.output,
              startedAt: blockStartedAt,
            });
            blockResults.set(blockId, result);
            await safeUpdateBlockRun(blockRunId, {
              status: "waiting",
              output: (result.output as Record<string, unknown> | undefined) ?? {},
              startedAt: blockStartedAt,
              // leave finishedAt null — the block is paused, not done
            });
            if (params.workflowRunId) emit({ type: "block_waiting", tenantId: workflow.tenantId, workflowId: workflow.id, runId: params.workflowRunId, blockId, blockType: node.type });
            return { kind: "paused", blockId, taskId: result.waitingForResume.taskId };
          }

          state.set(blockId, { status: "completed", output: result.output, completedAt: blockFinishedAt });
          blockResults.set(blockId, result);
          completed.add(blockId);

          const blockDuration = blockFinishedAt.getTime() - blockStartedAt.getTime();
          await safeUpdateBlockRun(blockRunId, {
            status: "completed",
            output: (result.output as Record<string, unknown> | undefined) ?? {},
            selectedHandle: result.selectedHandle ?? null,
            finishedAt: blockFinishedAt,
            durationMs: blockDuration,
          });
          if (params.workflowRunId) emit({ type: "block_completed", tenantId: workflow.tenantId, workflowId: workflow.id, runId: params.workflowRunId, blockId, blockType: node.type, durationMs: blockDuration });

          const activated = getActivatedBlocks(blockId, result.selectedHandle ?? null, dag);
          nextFrontier.push(...activated);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const blockFinishedAt = new Date();
          state.set(blockId, { status: "failed", error });
          failed.add(blockId);
          await safeUpdateBlockRun(blockRunId, {
            status: "failed",
            error,
            finishedAt: blockFinishedAt,
            durationMs: blockFinishedAt.getTime() - blockStartedAt.getTime(),
          });
          if (params.workflowRunId) emit({ type: "block_failed", tenantId: workflow.tenantId, workflowId: workflow.id, runId: params.workflowRunId, blockId, blockType: node.type, error });
        }
      }

      frontier = nextFrontier;
    }

    return { kind: "done", failed };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    async execute(workflowId: string, trigger?: TriggerPayload): Promise<WorkflowRunResult> {
      const workflow = await store.get(workflowId);
      if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

      const dag = buildDAG(workflow.blocks, workflow.edges);
      if (!dag.startNodeId) throw new Error(`Workflow has no trigger block: ${workflowId}`);

      const state = createExecutionState();
      const blockResults = new Map<string, BlockHandlerResult>();
      const nameToId = new Map<string, string>();
      for (const [id, node] of dag.nodes) nameToId.set(node.name, id);

      const completed = new Set<string>();
      const failed = new Set<string>();

      // Persist run
      const runStartedAt = new Date();
      const triggerType = (trigger?.type as RunTriggerType | undefined) ?? "manual";
      const persistedRunId = await safeCreateRun({
        tenantId: workflow.tenantId,
        workflowId,
        triggerType,
        triggerPayload: (trigger?.data as Record<string, unknown> | undefined) ?? undefined,
      });
      await safeUpdateRun(persistedRunId, { status: "running" });
      if (persistedRunId) emit({ type: "run_started", tenantId: workflow.tenantId, workflowId, runId: persistedRunId });

      // Run the trigger block synthetically — it has no handler logic, just
      // carries the incoming trigger payload as its "output" for downstream.
      const startNode = dag.nodes.get(dag.startNodeId)!;
      const triggerResult: BlockHandlerResult = { output: trigger?.data ?? {} };
      state.set(dag.startNodeId, { status: "completed", output: triggerResult.output, completedAt: new Date() });
      blockResults.set(dag.startNodeId, triggerResult);
      completed.add(dag.startNodeId);

      const triggerStart = new Date();
      const triggerBlockRunId = await safeCreateBlockRun({
        workflowRunId: persistedRunId ?? "",
        tenantId: workflow.tenantId,
        blockId: dag.startNodeId,
        blockName: startNode.name,
        blockType: startNode.type,
        status: "running",
      });
      await safeUpdateBlockRun(triggerBlockRunId, {
        status: "completed",
        resolvedConfig: (startNode.config ?? {}) as Record<string, unknown>,
        inputContext: {},
        output: (trigger?.data as Record<string, unknown> | undefined) ?? {},
        startedAt: triggerStart,
        finishedAt: triggerStart,
        durationMs: 0,
      });

      const initialFrontier = getActivatedBlocks(dag.startNodeId, null, dag);
      const outcome = await walk({
        workflowRunId: persistedRunId,
        workflow, dag, nameToId, state, completed, failed, blockResults,
        frontier: initialFrontier,
      });

      return finalizeRun(persistedRunId, runStartedAt, outcome, blockResults);
    },

    async resume(runId: string, userInput?: Record<string, unknown>): Promise<WorkflowRunResult> {
      if (!runStore) throw new Error("resume() requires a runStore");
      const run = await runStore.getRun(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      if (run.status !== "waiting_for_human") {
        throw new Error(`Run ${runId} is not waiting (status=${run.status})`);
      }
      if (!run.pausedAtBlockId) {
        throw new Error(`Run ${runId} has no paused_at_block_id — can't resume`);
      }

      const workflow = await store.get(run.workflowId);
      if (!workflow) throw new Error(`Workflow not found: ${run.workflowId}`);

      const dag = buildDAG(workflow.blocks, workflow.edges);
      const nameToId = new Map<string, string>();
      for (const [id, node] of dag.nodes) nameToId.set(node.name, id);

      // Rehydrate state from previously-completed block runs
      const blockRuns = await runStore.listBlockRuns(runId);
      const state = createExecutionState();
      const completed = new Set<string>();
      const failed = new Set<string>();
      const blockResults = new Map<string, BlockHandlerResult>();

      for (const br of blockRuns) {
        if (br.blockId === run.pausedAtBlockId) continue; // we'll finalize this one below
        if (br.status === "completed") {
          state.set(br.blockId, {
            status: "completed",
            output: br.output ?? {},
            startedAt: br.startedAt ?? undefined,
            completedAt: br.finishedAt ?? undefined,
          });
          completed.add(br.blockId);
          blockResults.set(br.blockId, { output: (br.output as Record<string, unknown>) ?? {} });
        } else if (br.status === "failed") {
          state.set(br.blockId, { status: "failed", error: br.error ?? "previously failed" });
          failed.add(br.blockId);
        } else if (br.status === "skipped") {
          state.set(br.blockId, { status: "skipped" });
          completed.add(br.blockId); // skipped blocks count as resolved for dependency checks
        }
      }

      // Finalize the paused block: mark completed with merged output (original + userInput)
      const pausedBlockRun = blockRuns.find((b) => b.blockId === run.pausedAtBlockId);
      if (!pausedBlockRun) throw new Error(`Paused block run not found for block ${run.pausedAtBlockId}`);
      const resumedAt = new Date();
      const mergedOutput: Record<string, unknown> = {
        ...((pausedBlockRun.output as Record<string, unknown>) ?? {}),
        waiting: false,
        userInput: userInput ?? {},
      };
      state.set(run.pausedAtBlockId, { status: "completed", output: mergedOutput, completedAt: resumedAt });
      completed.add(run.pausedAtBlockId);
      blockResults.set(run.pausedAtBlockId, { output: mergedOutput });

      await safeUpdateBlockRun(pausedBlockRun.id, {
        status: "completed",
        output: mergedOutput,
        finishedAt: resumedAt,
        durationMs: pausedBlockRun.startedAt ? resumedAt.getTime() - pausedBlockRun.startedAt.getTime() : undefined,
      });

      // Update run row — we're running again
      await safeUpdateRun(runId, {
        status: "running",
        pausedAtBlockId: null,
        awaitingActionTaskId: null,
      });

      // Resume the DAG walk starting from the paused block's outgoing edges
      const resumeFrontier = getActivatedBlocks(run.pausedAtBlockId, null, dag);
      const outcome = await walk({
        workflowRunId: runId,
        workflow, dag, nameToId, state, completed, failed, blockResults,
        frontier: resumeFrontier,
      });

      // Finalize — we don't have an original startedAt for duration purposes; use the existing one
      const runStartedAt = run.startedAt ?? resumedAt;
      return finalizeRun(runId, runStartedAt, outcome, blockResults);
    },

    async cancel(_runId: string): Promise<void> {
      // Cancellation of running workflows is not supported by the in-process engine yet.
      // Future: use a cancellation token threaded through walk() to short-circuit between blocks.
    },
  };

  async function finalizeRun(
    runId: string | null,
    runStartedAt: Date,
    outcome: { kind: "done"; failed: Set<string> } | { kind: "paused"; blockId: string; taskId: string },
    blockResults: Map<string, BlockHandlerResult>,
  ): Promise<WorkflowRunResult> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - runStartedAt.getTime();

    if (outcome.kind === "paused") {
      await safeUpdateRun(runId, {
        status: "waiting_for_human",
        pausedAtBlockId: outcome.blockId,
        awaitingActionTaskId: outcome.taskId,
      });
      // Pull the workflow id by looking it up on the run row — we only have runId here
      if (runId && runStore) {
        const row = await runStore.getRun(runId).catch(() => null);
        if (row) emit({ type: "run_paused", tenantId: row.tenantId, workflowId: row.workflowId, runId, blockId: outcome.blockId, awaitingActionTaskId: outcome.taskId });
      }
      return {
        runId: runId ?? generateId(),
        status: "waiting_for_human",
        blockResults,
        awaitingActionTaskId: outcome.taskId,
      };
    }

    const hasFailure = outcome.failed.size > 0;
    await safeUpdateRun(runId, {
      status: hasFailure ? "failed" : "completed",
      error: hasFailure ? `${outcome.failed.size} block(s) failed` : null,
      finishedAt,
      durationMs,
    });
    if (runId && runStore) {
      const row = await runStore.getRun(runId).catch(() => null);
      if (row) {
        emit(hasFailure
          ? { type: "run_failed",    tenantId: row.tenantId, workflowId: row.workflowId, runId, error: `${outcome.failed.size} block(s) failed` }
          : { type: "run_completed", tenantId: row.tenantId, workflowId: row.workflowId, runId });
      }
    }

    return {
      runId: runId ?? generateId(),
      status: hasFailure ? "failed" : "completed",
      blockResults,
      error: hasFailure ? `${outcome.failed.size} block(s) failed` : undefined,
    };
  }
}

function getActivatedBlocks(
  blockId: string,
  selectedHandle: string | null,
  dag: { nodes: Map<string, DAGNode> },
): string[] {
  const node = dag.nodes.get(blockId);
  if (!node) return [];

  return node.outgoingEdges
    .filter((edge) => {
      if (selectedHandle === null) return true;
      if (edge.sourceHandle === null) return true;
      return edge.sourceHandle === selectedHandle;
    })
    .map((edge) => edge.targetBlockId);
}

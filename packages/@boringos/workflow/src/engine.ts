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
} from "./types.js";
import { buildDAG } from "./dag.js";
import { createExecutionState, resolveTemplate } from "./state.js";
import type { HandlerRegistry } from "./handler-registry.js";
import type { WorkflowRunStore, RunTriggerType } from "./run-store.js";
import { generateId } from "@boringos/shared";

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
   */
  runStore?: WorkflowRunStore;
}

export function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine {
  const { store, handlers, services, runStore } = config;

  // Persistence wrappers — swallow errors so a DB hiccup never kills a workflow.
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

  // Snapshot the outputs of all completed blocks — used as "input context"
  // for the next block, so the UI can show exactly what data was visible.
  function snapshotState(state: { get(id: string): BlockState | undefined }, nameToId: Map<string, string>): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    for (const [name, id] of nameToId) {
      const bs = state.get(id);
      if (bs?.status === "completed" && bs.output !== undefined) snap[name] = bs.output;
    }
    return snap;
  }

  return {
    async execute(workflowId: string, trigger?: TriggerPayload): Promise<WorkflowRunResult> {
      const workflow = await store.get(workflowId);
      if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

      const dag = buildDAG(workflow.blocks, workflow.edges);
      if (!dag.startNodeId) throw new Error(`Workflow has no trigger block: ${workflowId}`);

      const state = createExecutionState();
      const blockResults = new Map<string, BlockHandlerResult>();

      // Build name→id map for template resolution
      const nameToId = new Map<string, string>();
      for (const [id, node] of dag.nodes) {
        nameToId.set(node.name, id);
      }

      // Track completed block IDs for dependency checking
      const completed = new Set<string>();
      const failed = new Set<string>();

      // --- Persistence: create the workflow run row up-front ---
      const runStartedAt = new Date();
      const triggerType = (trigger?.type as RunTriggerType | undefined) ?? "manual";
      const persistedRunId = await safeCreateRun({
        tenantId: workflow.tenantId,
        workflowId,
        triggerType,
        triggerPayload: (trigger?.data as Record<string, unknown> | undefined) ?? undefined,
      });
      await safeUpdateRun(persistedRunId, { status: "running", finishedAt: undefined });
      // startedAt not on update input currently — write via raw path below if needed.
      // The drizzle migration has startedAt; we set it in createRun path? Not ideal —
      // let's add startedAt through the run row's createdAt proximity for v1 and let
      // Phase 1.5 tighten. For now: keep it simple.

      // --- Execute start node (the trigger block) ---
      const startNode = dag.nodes.get(dag.startNodeId)!;
      const triggerResult: BlockHandlerResult = {
        output: trigger?.data ?? {},
      };
      state.set(dag.startNodeId, { status: "completed", output: triggerResult.output, completedAt: new Date() });
      blockResults.set(dag.startNodeId, triggerResult);
      completed.add(dag.startNodeId);

      // Persist trigger block as a completed block run (instantaneous)
      const startBlockRunId = await safeCreateBlockRun({
        workflowRunId: persistedRunId ?? "",
        tenantId: workflow.tenantId,
        blockId: dag.startNodeId,
        blockName: startNode.name,
        blockType: startNode.type,
        status: "running",
      });
      const startedTrigger = new Date();
      await safeUpdateBlockRun(startBlockRunId, {
        status: "completed",
        resolvedConfig: (startNode.config ?? {}) as Record<string, unknown>,
        inputContext: {},
        output: (trigger?.data as Record<string, unknown> | undefined) ?? {},
        startedAt: startedTrigger,
        finishedAt: startedTrigger,
        durationMs: 0,
      });

      // BFS walk through the graph
      let frontier = getActivatedBlocks(dag.startNodeId, null, dag);

      while (frontier.length > 0) {
        const nextFrontier: string[] = [];

        for (const blockId of frontier) {
          const node = dag.nodes.get(blockId);
          if (!node) continue;

          // Check all incoming dependencies are satisfied
          const allDependenciesMet = Array.from(node.incomingBlockIds).every(
            (depId) => completed.has(depId) || failed.has(depId),
          );
          if (!allDependenciesMet) {
            nextFrontier.push(blockId);
            continue;
          }

          // Skip if any dependency failed
          const anyDepFailed = Array.from(node.incomingBlockIds).some((depId) => failed.has(depId));
          if (anyDepFailed) {
            state.set(blockId, { status: "skipped" });
            completed.add(blockId);
            const skippedId = await safeCreateBlockRun({
              workflowRunId: persistedRunId ?? "",
              tenantId: workflow.tenantId,
              blockId,
              blockName: node.name,
              blockType: node.type,
              status: "skipped",
            });
            await safeUpdateBlockRun(skippedId, {
              status: "skipped",
              error: "upstream block failed",
              finishedAt: new Date(),
            });
            continue;
          }

          // Find handler
          const handler = handlers.get(node.type);
          if (!handler) {
            const err = `No handler for block type: ${node.type}`;
            state.set(blockId, { status: "failed", error: err });
            failed.add(blockId);
            const noHandlerId = await safeCreateBlockRun({
              workflowRunId: persistedRunId ?? "",
              tenantId: workflow.tenantId,
              blockId,
              blockName: node.name,
              blockType: node.type,
              status: "failed",
            });
            await safeUpdateBlockRun(noHandlerId, { status: "failed", error: err, finishedAt: new Date() });
            continue;
          }

          // Resolve config templates
          const resolvedConfig: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(node.config)) {
            resolvedConfig[key] = typeof value === "string"
              ? resolveTemplate(value, state, nameToId)
              : value;
          }

          // Persist the block run (status=running) BEFORE executing so live views see it
          const blockStartedAt = new Date();
          state.set(blockId, { status: "running", startedAt: blockStartedAt });
          const blockRunId = await safeCreateBlockRun({
            workflowRunId: persistedRunId ?? "",
            tenantId: workflow.tenantId,
            blockId,
            blockName: node.name,
            blockType: node.type,
            status: "running",
          });
          const inputContextSnapshot = snapshotState(state, nameToId);
          await safeUpdateBlockRun(blockRunId, {
            status: "running",
            resolvedConfig,
            inputContext: inputContextSnapshot,
            startedAt: blockStartedAt,
          });

          try {
            const ctx: BlockHandlerContext = {
              blockId,
              blockName: node.name,
              blockType: node.type,
              config: resolvedConfig,
              workflowRunId: persistedRunId ?? generateId(),
              workflowId,
              tenantId: workflow.tenantId,
              governingAgentId: workflow.governingAgentId,
              workflowType: workflow.type,
              state,
              services,
            };

            const result = await handler.execute(ctx);
            const blockFinishedAt = new Date();
            state.set(blockId, { status: "completed", output: result.output, completedAt: blockFinishedAt });
            blockResults.set(blockId, result);
            completed.add(blockId);

            await safeUpdateBlockRun(blockRunId, {
              status: "completed",
              output: (result.output as Record<string, unknown> | undefined) ?? {},
              selectedHandle: result.selectedHandle ?? null,
              finishedAt: blockFinishedAt,
              durationMs: blockFinishedAt.getTime() - blockStartedAt.getTime(),
            });

            // Get next blocks — respecting selectedHandle for branching
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
          }
        }

        frontier = nextFrontier;
      }

      const hasFailure = failed.size > 0;
      const runFinishedAt = new Date();
      const runDurationMs = runFinishedAt.getTime() - runStartedAt.getTime();

      // Persist final run status
      await safeUpdateRun(persistedRunId, {
        status: hasFailure ? "failed" : "completed",
        error: hasFailure ? `${failed.size} block(s) failed` : null,
        finishedAt: runFinishedAt,
        durationMs: runDurationMs,
      });

      return {
        runId: persistedRunId ?? generateId(),
        status: hasFailure ? "failed" : "completed",
        blockResults,
        error: hasFailure ? `${failed.size} block(s) failed` : undefined,
      };
    },

    async cancel(_runId: string): Promise<void> {
      // In-process engine doesn't support cancellation of running workflows yet
    },
  };
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
      // If no handle selection, activate all edges
      if (selectedHandle === null) return true;
      // If edge has no handle constraint, activate it
      if (edge.sourceHandle === null) return true;
      // Only activate edges matching the selected handle
      return edge.sourceHandle === selectedHandle;
    })
    .map((edge) => edge.targetBlockId);
}

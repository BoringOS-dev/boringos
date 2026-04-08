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
import { generateId } from "@boringos/shared";

export interface WorkflowEngineConfig {
  store: WorkflowStore;
  handlers: HandlerRegistry;
  services: ServiceAccessor;
}

export function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine {
  const { store, handlers, services } = config;

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

      // Execute start node
      const startNode = dag.nodes.get(dag.startNodeId)!;
      const triggerResult: BlockHandlerResult = {
        output: trigger?.data ?? {},
      };
      state.set(dag.startNodeId, { status: "completed", output: triggerResult.output, completedAt: new Date() });
      blockResults.set(dag.startNodeId, triggerResult);
      completed.add(dag.startNodeId);

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
            continue;
          }

          // Find handler
          const handler = handlers.get(node.type);
          if (!handler) {
            state.set(blockId, { status: "failed", error: `No handler for block type: ${node.type}` });
            failed.add(blockId);
            continue;
          }

          // Resolve config templates
          const resolvedConfig: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(node.config)) {
            resolvedConfig[key] = typeof value === "string"
              ? resolveTemplate(value, state, nameToId)
              : value;
          }

          // Execute block
          state.set(blockId, { status: "running", startedAt: new Date() });

          try {
            const ctx: BlockHandlerContext = {
              blockId,
              blockName: node.name,
              blockType: node.type,
              config: resolvedConfig,
              workflowRunId: generateId(),
              workflowId,
              tenantId: workflow.tenantId,
              governingAgentId: workflow.governingAgentId,
              workflowType: workflow.type,
              state,
              services,
            };

            const result = await handler.execute(ctx);
            state.set(blockId, { status: "completed", output: result.output, completedAt: new Date() });
            blockResults.set(blockId, result);
            completed.add(blockId);

            // Get next blocks — respecting selectedHandle for branching
            const activated = getActivatedBlocks(blockId, result.selectedHandle ?? null, dag);
            nextFrontier.push(...activated);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            state.set(blockId, { status: "failed", error });
            failed.add(blockId);
          }
        }

        frontier = nextFrontier;
      }

      const hasFailure = failed.size > 0;
      return {
        runId: generateId(),
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

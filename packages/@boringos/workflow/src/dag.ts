import type { DAG, DAGNode, DAGEdge, BlockDefinition, EdgeDefinition } from "./types.js";

export function buildDAG(blocks: BlockDefinition[], edges: EdgeDefinition[]): DAG {
  const nodes = new Map<string, DAGNode>();
  let startNodeId: string | null = null;

  for (const block of blocks) {
    nodes.set(block.id, {
      id: block.id,
      name: block.name,
      type: block.type,
      config: block.config,
      incomingBlockIds: new Set(),
      outgoingEdges: [],
    });

    if (block.type === "trigger") {
      startNodeId = block.id;
    }
  }

  const sortedEdges = [...edges].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const edge of sortedEdges) {
    const source = nodes.get(edge.sourceBlockId);
    const target = nodes.get(edge.targetBlockId);
    if (!source || !target) continue;

    source.outgoingEdges.push({
      targetBlockId: edge.targetBlockId,
      sourceHandle: edge.sourceHandle,
    });

    target.incomingBlockIds.add(edge.sourceBlockId);
  }

  return { nodes, startNodeId };
}

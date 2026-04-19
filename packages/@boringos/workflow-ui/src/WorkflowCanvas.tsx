import { useMemo, useCallback, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { WorkflowBlock, WorkflowEdge, BlockRun, BlockRunStatus } from "./types.js";

// ── Category → visual treatment ────────────────────────────────────────────

const CATEGORY: Record<string, { label: string; color: string; border: string }> = {
  // Trigger entry
  trigger:              { label: "TRIGGER",  color: "bg-surface-purple",   border: "border-text-purple/40" },
  // External side-effects
  "connector-action":   { label: "CONNECTOR", color: "bg-surface-green",    border: "border-text-green/40" },
  "create-inbox-item":  { label: "CONNECTOR", color: "bg-surface-green",    border: "border-text-green/40" },
  "emit-event":         { label: "CONNECTOR", color: "bg-surface-green",    border: "border-text-green/40" },
  // Agent ops
  "wake-agent":         { label: "AGENT",    color: "bg-surface-purple",   border: "border-text-purple/40" },
  // Database
  "query-database":     { label: "DB",       color: "bg-surface-blue",     border: "border-text-blue/40" },
  "update-row":         { label: "DB",       color: "bg-surface-blue",     border: "border-text-blue/40" },
  "create-task":        { label: "DB",       color: "bg-surface-blue",     border: "border-text-blue/40" },
  // Flow control
  condition:            { label: "FLOW",     color: "bg-surface-amber",    border: "border-text-amber/40" },
  "for-each":           { label: "FLOW",     color: "bg-surface-amber",    border: "border-text-amber/40" },
  delay:                { label: "FLOW",     color: "bg-bg-secondary",     border: "border-border" },
  transform:            { label: "FLOW",     color: "bg-bg-secondary",     border: "border-border" },
  // Human-in-loop
  "wait-for-human":     { label: "HUMAN",    color: "bg-surface-red",      border: "border-text-red/40" },
};

function categoryFor(type: string) {
  return CATEGORY[type] ?? { label: "BLOCK", color: "bg-bg-secondary", border: "border-border" };
}

// ── Status → visual treatment ──────────────────────────────────────────────

function statusClass(status: BlockRunStatus | null | undefined): string {
  switch (status) {
    case "completed": return "ring-2 ring-text-green/50";
    case "failed":    return "ring-2 ring-text-red/50";
    case "running":   return "ring-2 ring-text-amber/60 animate-pulse";
    case "waiting":   return "ring-2 ring-text-purple/60";
    case "skipped":   return "opacity-60";
    default:          return "";
  }
}

function statusDot(status: BlockRunStatus | null | undefined): string {
  switch (status) {
    case "completed": return "bg-text-green";
    case "failed":    return "bg-text-red";
    case "running":   return "bg-text-amber animate-pulse";
    case "waiting":   return "bg-text-purple";
    case "skipped":   return "bg-text-tertiary";
    default:          return "";
  }
}

// ── Custom node ────────────────────────────────────────────────────────────

type BlockNodeData = {
  name: string;
  type: string;
  status: BlockRunStatus | null;
  durationMs: number | null;
  selected?: boolean;
  /** True if this block type has branching (condition). Renders two output handles. */
  hasBranches: boolean;
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function BlockNode({ data }: NodeProps<Node<BlockNodeData>>) {
  const cat = categoryFor(data.type);
  const isTrigger = data.type === "trigger";

  return (
    <div
      className={`relative rounded-md border ${cat.border} ${data.selected ? "ring-2 ring-accent" : statusClass(data.status)} shadow-sm bg-bg min-w-[180px] max-w-[220px]`}
    >
      {/* Inbound handle (hidden for trigger nodes) */}
      {!isTrigger && (
        <Handle type="target" position={Position.Left} className="!bg-text-tertiary !w-2 !h-2 !border-none" />
      )}

      <div className={`px-2.5 py-1.5 rounded-t-md ${cat.color}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider font-semibold text-text-secondary">{cat.label}</span>
          {data.status && (
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(data.status)} ml-auto`} />
          )}
        </div>
      </div>

      <div className="px-2.5 py-1.5">
        <div className="text-sm font-medium text-text-primary truncate">{data.name}</div>
        <div className="text-[10px] text-text-tertiary font-mono truncate">{data.type}</div>
        {data.durationMs !== null && (
          <div className="text-[10px] text-text-tertiary mt-0.5">{formatDuration(data.durationMs)}</div>
        )}
      </div>

      {/* Output handles — two for branching blocks, one otherwise */}
      {data.hasBranches ? (
        <>
          <Handle
            type="source" position={Position.Right} id="condition-true"
            className="!bg-text-green !w-2 !h-2 !border-none"
            style={{ top: "40%" }}
          />
          <Handle
            type="source" position={Position.Right} id="condition-false"
            className="!bg-text-red !w-2 !h-2 !border-none"
            style={{ top: "70%" }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!bg-text-tertiary !w-2 !h-2 !border-none" />
      )}
    </div>
  );
}

const nodeTypes = { block: BlockNode } as const;

// ── Auto-layout via dagre (left-to-right) ──────────────────────────────────

function autoLayout(blocks: WorkflowBlock[], edges: WorkflowEdge[]): { nodes: Node<BlockNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });

  const NODE_W = 200;
  const NODE_H = 70;

  for (const b of blocks) {
    g.setNode(b.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.sourceBlockId, e.targetBlockId);
  }

  dagre.layout(g);

  const nodes: Node<BlockNodeData>[] = blocks.map((b) => {
    const pos = g.node(b.id);
    return {
      id: b.id,
      type: "block",
      position: { x: pos ? pos.x - NODE_W / 2 : 0, y: pos ? pos.y - NODE_H / 2 : 0 },
      data: {
        name: b.name,
        type: b.type,
        status: null,
        durationMs: null,
        hasBranches: b.type === "condition",
      },
    };
  });

  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.sourceBlockId,
    target: e.targetBlockId,
    sourceHandle: e.sourceHandle ?? undefined,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: {
      stroke: e.sourceHandle === "condition-true" ? "rgb(34 197 94)" // text-green
            : e.sourceHandle === "condition-false" ? "rgb(239 68 68)" // text-red
            : undefined,
    },
  }));

  return { nodes, edges: rfEdges };
}

// ── Public component ───────────────────────────────────────────────────────

export interface WorkflowCanvasProps {
  blocks: WorkflowBlock[];
  edges: WorkflowEdge[];
  /** Optional per-block runtime status — overlays on nodes. */
  blockRuns?: BlockRun[];
  /** Selected block id for highlighting. */
  selectedBlockId?: string | null;
  /** Callback when a node is clicked. */
  onBlockClick?: (blockId: string) => void;
  /** Height of the canvas in CSS. Defaults to 400px. */
  height?: number | string;
  /**
   * `"view"` (default) — read-only, used on detail/run pages.
   * `"edit"` — nodes draggable, edges connectable, delete + backspace remove
   * nodes/edges. In this mode, `onGraphChange` fires on any structural
   * mutation (node added/moved/removed, edge added/removed) with the new
   * blocks + edges arrays. Position of moved nodes is preserved in memory
   * only — not currently persisted (workflow schema has no position field
   * yet; auto-layout runs on load).
   */
  mode?: "view" | "edit";
  onGraphChange?: (blocks: WorkflowBlock[], edges: WorkflowEdge[]) => void;
}

export function WorkflowCanvas({
  blocks, edges, blockRuns, selectedBlockId, onBlockClick,
  height = 400, mode = "view", onGraphChange,
}: WorkflowCanvasProps) {
  const laidOut = useMemo(() => autoLayout(blocks, edges), [blocks, edges]);

  // In edit mode we carry local node positions so dragging works; in view mode
  // we re-derive from auto-layout every render.
  const [editNodes, setEditNodes] = useState<Node<BlockNodeData>[]>(laidOut.nodes);
  const [editEdges, setEditEdges] = useState<Edge[]>(laidOut.edges);

  // When inputs change externally (palette adds a node, edit elsewhere), resync.
  useEffect(() => {
    setEditNodes(laidOut.nodes);
    setEditEdges(laidOut.edges);
  }, [laidOut.nodes, laidOut.edges]);

  // Overlay runtime data on top of layout (only relevant in view mode with runs)
  const runById = useMemo(() => {
    const m = new Map<string, BlockRun>();
    for (const br of blockRuns ?? []) m.set(br.blockId, br);
    return m;
  }, [blockRuns]);

  const baseNodes = mode === "edit" ? editNodes : laidOut.nodes;

  const displayNodes = useMemo<Node<BlockNodeData>[]>(() =>
    baseNodes.map((n) => {
      const run = runById.get(n.id);
      return {
        ...n,
        data: {
          ...n.data,
          status: (run?.status as BlockRunStatus | undefined) ?? null,
          durationMs: run?.durationMs ?? null,
          selected: selectedBlockId === n.id,
        },
      };
    }),
  [baseNodes, runById, selectedBlockId]);

  const displayEdges = mode === "edit" ? editEdges : laidOut.edges;

  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    onBlockClick?.(node.id);
  }, [onBlockClick]);

  // ── Edit-mode handlers ────────────────────────────────────────────────────

  const emitChange = useCallback((nodes: Node[], edges: Edge[]) => {
    // Project react-flow state back into blocks + edges
    const newBlocks: WorkflowBlock[] = nodes.map((n) => {
      const orig = blocks.find((b) => b.id === n.id);
      return orig ?? {
        id: n.id,
        name: (n.data as BlockNodeData)?.name ?? n.id,
        type: (n.data as BlockNodeData)?.type ?? "unknown",
        config: {},
      };
    });
    const newEdges: WorkflowEdge[] = edges.map((e, i) => ({
      id: e.id,
      sourceBlockId: e.source,
      targetBlockId: e.target,
      sourceHandle: e.sourceHandle ?? null,
      sortOrder: i,
    }));
    onGraphChange?.(newBlocks, newEdges);
  }, [blocks, onGraphChange]);

  const onNodesChange: OnNodesChange<Node<BlockNodeData>> = useCallback((changes) => {
    setEditNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      // Only emit when nodes are added/removed (not on every drag tick)
      const structural = changes.some((c) => c.type === "remove" || c.type === "add");
      if (structural) emitChange(next, editEdges);
      return next;
    });
  }, [editEdges, emitChange]);

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEditEdges((eds) => {
      const next = applyEdgeChanges(changes, eds);
      const structural = changes.some((c) => c.type === "remove" || c.type === "add");
      if (structural) emitChange(editNodes, next);
      return next;
    });
  }, [editNodes, emitChange]);

  const onConnect = useCallback((conn: Connection) => {
    setEditEdges((eds) => {
      const newEdge: Edge = {
        id: `e-${conn.source}-${conn.target}-${Date.now()}`,
        source: conn.source!,
        target: conn.target!,
        sourceHandle: conn.sourceHandle,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: {
          stroke: conn.sourceHandle === "condition-true" ? "rgb(34 197 94)"
                : conn.sourceHandle === "condition-false" ? "rgb(239 68 68)"
                : undefined,
        },
      };
      const next = addEdge(newEdge, eds);
      emitChange(editNodes, next);
      return next;
    });
  }, [editNodes, emitChange]);

  return (
    <div style={{ height, width: "100%" }} className="border border-border rounded-md overflow-hidden bg-bg">
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={mode === "edit"}
        nodesConnectable={mode === "edit"}
        elementsSelectable
        deleteKeyCode={mode === "edit" ? ["Backspace", "Delete"] : null}
        onNodesChange={mode === "edit" ? onNodesChange : undefined}
        onEdgesChange={mode === "edit" ? onEdgesChange : undefined}
        onConnect={mode === "edit" ? onConnect : undefined}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color="currentColor" className="opacity-10" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

import type { WorkflowBlock } from "./types.js";

/**
 * Grouped catalog of every block type users can add to a workflow.
 * Each entry is a factory that produces a sensible starter block —
 * default config that's valid but incomplete (users configure from there).
 */
const PALETTE: Array<{ category: string; items: Array<{ type: string; label: string; description: string; defaults: () => Omit<WorkflowBlock, "id"> }> }> = [
  {
    category: "Triggers",
    items: [
      {
        type: "trigger",
        label: "Trigger",
        description: "Entry point — started by cron, event, webhook, or manual run.",
        defaults: () => ({ name: "trigger", type: "trigger", config: {} }),
      },
    ],
  },
  {
    category: "Flow control",
    items: [
      {
        type: "condition",
        label: "Condition",
        description: "Branch on a field. Outputs: true / false handles.",
        defaults: () => ({ name: "condition", type: "condition", config: { field: "", operator: "equals", value: "" } }),
      },
      {
        type: "for-each",
        label: "For each",
        description: "Iterate over an array from an upstream block.",
        defaults: () => ({ name: "loop", type: "for-each", config: { items: "{{source.items}}" } }),
      },
      {
        type: "delay",
        label: "Delay",
        description: "Wait a fixed duration before continuing.",
        defaults: () => ({ name: "delay", type: "delay", config: { durationMs: 1000 } }),
      },
      {
        type: "transform",
        label: "Transform",
        description: "Map / reshape data between blocks via template strings.",
        defaults: () => ({ name: "transform", type: "transform", config: { mappings: {} } }),
      },
    ],
  },
  {
    category: "Connectors",
    items: [
      {
        type: "connector-action",
        label: "Connector action",
        description: "Call a connector (Gmail, Calendar, Slack, …).",
        defaults: () => ({ name: "fetch", type: "connector-action", config: { connectorKind: "google", action: "list_emails", inputs: {} } }),
      },
      {
        type: "create-inbox-item",
        label: "Create inbox item",
        description: "Write to the framework inbox.",
        defaults: () => ({ name: "store", type: "create-inbox-item", config: { source: "workflow" } }),
      },
      {
        type: "emit-event",
        label: "Emit event",
        description: "Broadcast an event for other workflows / agents to react to.",
        defaults: () => ({ name: "emit", type: "emit-event", config: { connectorKind: "crm", eventType: "custom.event" } }),
      },
    ],
  },
  {
    category: "Database",
    items: [
      {
        type: "query-database",
        label: "Query database",
        description: "Read rows from a tenant-scoped table.",
        defaults: () => ({ name: "query", type: "query-database", config: { table: "tasks", where: {}, limit: 50 } }),
      },
      {
        type: "update-row",
        label: "Update rows",
        description: "Update rows in a tenant-scoped table (requires a where clause).",
        defaults: () => ({ name: "update", type: "update-row", config: { table: "tasks", where: { status: "todo" }, set: {} } }),
      },
      {
        type: "create-task",
        label: "Create task",
        description: "Create a task in the framework tasks table.",
        defaults: () => ({ name: "create_task", type: "create-task", config: { title: "New task", originKind: "workflow" } }),
      },
    ],
  },
  {
    category: "Agents & humans",
    items: [
      {
        type: "wake-agent",
        label: "Wake agent",
        description: "Wake a specific agent from this workflow.",
        defaults: () => ({ name: "wake", type: "wake-agent", config: { agentId: "", reason: "workflow_triggered" } }),
      },
      {
        type: "wait-for-human",
        label: "Wait for human",
        description: "Pause the workflow and create an Actions-queue card until a user approves.",
        defaults: () => ({ name: "approve", type: "wait-for-human", config: { title: "Approve this step", description: "Review and approve" } }),
      },
    ],
  },
  {
    category: "Composition",
    items: [
      {
        type: "invoke-workflow",
        label: "Invoke workflow",
        description: "Run another workflow as a sub-routine and capture its output.",
        defaults: () => ({ name: "invoke", type: "invoke-workflow", config: { workflowId: "", payload: {} } }),
      },
    ],
  },
];

export interface BlockPaletteProps {
  /**
   * Called when the user picks a block type. The parent assigns a unique
   * block id, positions the node, and appends it to the workflow graph.
   */
  onAdd: (starter: Omit<WorkflowBlock, "id">) => void;
}

export function BlockPalette({ onAdd }: BlockPaletteProps) {
  return (
    <div className="w-[240px] shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Blocks</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {PALETTE.map((group) => (
          <div key={group.category}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1.5 mb-1">
              {group.category}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  onClick={() => onAdd(item.defaults())}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors group"
                  title={item.description}
                >
                  <div className="text-xs font-medium text-text-primary">{item.label}</div>
                  <div className="text-[10px] text-text-tertiary font-mono">{item.type}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-text-tertiary">
        Click to add. Drag node corners to connect. <kbd className="px-1 rounded bg-bg-secondary">Del</kbd> to remove.
      </div>
    </div>
  );
}

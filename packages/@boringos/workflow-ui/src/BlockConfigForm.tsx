import { useState, useEffect } from "react";
import type { WorkflowBlock } from "./types.js";
import { useWorkflows } from "./hooks.js";

/**
 * Per-kind config editor for a selected block. Each block type has a
 * tailored form when it's a supported kind; everything else falls back
 * to a JSON editor.
 *
 * Parent passes the selected block, receives `onChange({ name, config })`
 * on any field edit. Parent is responsible for upserting into the
 * workflow's blocks array.
 */
export interface BlockConfigFormProps {
  block: WorkflowBlock;
  onChange: (updates: { name?: string; config?: Record<string, unknown> }) => void;
  onDelete?: () => void;
  /** Optional lookup of agents for wake-agent dropdown */
  agents?: Array<{ id: string; name: string; role: string }>;
}

export function BlockConfigForm({ block, onChange, onDelete, agents = [] }: BlockConfigFormProps) {
  return (
    <div className="border border-border rounded-md bg-bg">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary px-1.5 py-0.5 rounded border border-border">
          {block.type}
        </span>
        <span className="font-mono text-xs text-text-tertiary">{block.id}</span>
        <span className="flex-1" />
        {onDelete && (
          <button onClick={onDelete} className="text-xs text-text-red hover:underline">Delete</button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Name — editable on every block */}
        <FieldText
          label="Name"
          help="Referenced in templates as {{name.output}}"
          value={block.name}
          onChange={(v) => onChange({ name: v })}
          mono
        />

        {/* Type-specific fields */}
        <TypeSpecific block={block} onChange={onChange} agents={agents} />
      </div>
    </div>
  );
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

function TypeSpecific({ block, onChange, agents }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"]; agents: NonNullable<BlockConfigFormProps["agents"]> }) {
  switch (block.type) {
    case "trigger":           return <TriggerForm block={block} onChange={onChange} />;
    case "condition":         return <ConditionForm block={block} onChange={onChange} />;
    case "delay":             return <DelayForm block={block} onChange={onChange} />;
    case "for-each":          return <ForEachForm block={block} onChange={onChange} />;
    case "connector-action":  return <ConnectorActionForm block={block} onChange={onChange} />;
    case "wake-agent":        return <WakeAgentForm block={block} onChange={onChange} agents={agents} />;
    case "query-database":    return <QueryDatabaseForm block={block} onChange={onChange} />;
    case "update-row":        return <UpdateRowForm block={block} onChange={onChange} />;
    case "create-task":       return <CreateTaskForm block={block} onChange={onChange} />;
    case "wait-for-human":    return <WaitForHumanForm block={block} onChange={onChange} />;
    case "emit-event":        return <EmitEventForm block={block} onChange={onChange} />;
    case "create-inbox-item": return <CreateInboxItemForm block={block} onChange={onChange} />;
    case "invoke-workflow":   return <InvokeWorkflowForm block={block} onChange={onChange} />;
    case "transform":         return <JSONFallbackForm block={block} onChange={onChange} />;
    default:                  return <JSONFallbackForm block={block} onChange={onChange} />;
  }
}

// ── Reusable field components ──────────────────────────────────────────────

function FieldText({ label, help, value, onChange, placeholder, mono }: {
  label: string; help?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">{label}</span>
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full text-sm border border-border rounded px-2 py-1 bg-bg ${mono ? "font-mono" : ""}`}
      />
      {help && <span className="block text-[10px] text-text-tertiary mt-0.5">{help}</span>}
    </label>
  );
}

function FieldTextarea({ label, help, value, onChange, rows = 3, mono }: {
  label: string; help?: string; value: string; onChange: (v: string) => void;
  rows?: number; mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`w-full text-sm border border-border rounded px-2 py-1 bg-bg resize-y ${mono ? "font-mono" : ""}`}
      />
      {help && <span className="block text-[10px] text-text-tertiary mt-0.5">{help}</span>}
    </label>
  );
}

function FieldSelect<T extends string>({ label, help, value, onChange, options }: {
  label: string; help?: string; value: T; onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full text-sm border border-border rounded px-2 py-1 bg-bg"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <span className="block text-[10px] text-text-tertiary mt-0.5">{help}</span>}
    </label>
  );
}

function FieldNumber({ label, help, value, onChange, placeholder }: {
  label: string; help?: string; value: number | undefined; onChange: (v: number) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">{label}</span>
      <input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full text-sm border border-border rounded px-2 py-1 bg-bg"
      />
      {help && <span className="block text-[10px] text-text-tertiary mt-0.5">{help}</span>}
    </label>
  );
}

/** JSON textarea with live parse — shows an error banner if the current text isn't valid JSON. */
function FieldJSON({ label, help, value, onChange, rows = 6 }: {
  label: string; help?: string; value: unknown; onChange: (v: unknown) => void; rows?: number;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  // Reset text when the externally-held value changes from outside (e.g. block switch)
  useEffect(() => {
    const pretty = JSON.stringify(value ?? {}, null, 2);
    setText(pretty);
    setError(null);
  }, [value]);

  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">{label}</span>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
        rows={rows}
        className="w-full text-xs border border-border rounded px-2 py-1 bg-bg resize-y font-mono"
      />
      {error ? (
        <span className="block text-[10px] text-text-red mt-0.5">Invalid JSON: {error}</span>
      ) : help ? (
        <span className="block text-[10px] text-text-tertiary mt-0.5">{help}</span>
      ) : null}
    </label>
  );
}

// ── Type-specific forms ────────────────────────────────────────────────────

function setField<T extends Record<string, unknown>>(block: WorkflowBlock, key: string, value: unknown, onChange: BlockConfigFormProps["onChange"]) {
  const next = { ...block.config, [key]: value } as T;
  onChange({ config: next });
}

function TriggerForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  // Triggers currently accept free-form config; most triggers work with no fields.
  // (When Phase 7 event-dispatch lands, this becomes a typed kind picker.)
  return (
    <FieldJSON
      label="Trigger config"
      help="Optional. Cron-backed routines set their own schedule; manual triggers need no config."
      value={block.config}
      onChange={(v) => onChange({ config: v as Record<string, unknown> })}
    />
  );
}

function ConditionForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { field?: string; operator?: string; value?: unknown };
  return (
    <>
      <FieldText
        label="Field"
        help="Path from an upstream block, e.g. {{fetch.score}}"
        value={(cfg.field as string) ?? ""}
        onChange={(v) => setField(block, "field", v, onChange)}
        mono
      />
      <FieldSelect
        label="Operator"
        value={(cfg.operator as string) ?? "equals"}
        onChange={(v) => setField(block, "operator", v, onChange)}
        options={[
          { value: "equals",     label: "equals" },
          { value: "not_equals", label: "not equals" },
          { value: "contains",   label: "contains" },
          { value: "truthy",     label: "is truthy" },
        ]}
      />
      <FieldText
        label="Value"
        value={String(cfg.value ?? "")}
        onChange={(v) => setField(block, "value", v, onChange)}
        mono
      />
    </>
  );
}

function DelayForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { durationMs?: number; seconds?: number };
  return (
    <>
      <FieldNumber
        label="Duration (ms)"
        help="Milliseconds to wait before continuing."
        value={cfg.durationMs}
        onChange={(v) => setField(block, "durationMs", v, onChange)}
      />
    </>
  );
}

function ForEachForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { items?: string; itemKey?: string };
  return (
    <>
      <FieldText
        label="Items"
        help="Template referencing an array, e.g. {{fetch.messages}}"
        value={(cfg.items as string) ?? ""}
        onChange={(v) => setField(block, "items", v, onChange)}
        mono
      />
      <FieldText
        label="Item variable (optional)"
        help="Defaults to `item`"
        value={(cfg.itemKey as string) ?? ""}
        onChange={(v) => setField(block, "itemKey", v, onChange)}
        mono
      />
    </>
  );
}

function ConnectorActionForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { connectorKind?: string; action?: string; inputs?: Record<string, unknown> };
  return (
    <>
      <FieldSelect
        label="Connector"
        value={(cfg.connectorKind as string) ?? "google"}
        onChange={(v) => setField(block, "connectorKind", v, onChange)}
        options={[
          { value: "google", label: "Google Workspace (Gmail + Calendar)" },
          { value: "slack",  label: "Slack" },
        ]}
      />
      <FieldText
        label="Action"
        help="e.g. list_emails, send_email, list_events, create_event, send_message"
        value={(cfg.action as string) ?? ""}
        onChange={(v) => setField(block, "action", v, onChange)}
        mono
      />
      <FieldJSON
        label="Inputs"
        help="Action-specific payload. May reference {{block.field}}."
        value={cfg.inputs ?? {}}
        onChange={(v) => setField(block, "inputs", v, onChange)}
        rows={4}
      />
    </>
  );
}

function WakeAgentForm({ block, onChange, agents }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"]; agents: NonNullable<BlockConfigFormProps["agents"]> }) {
  const cfg = block.config as { agentId?: string; reason?: string; taskId?: string };
  return (
    <>
      {agents.length > 0 ? (
        <FieldSelect
          label="Agent"
          value={(cfg.agentId as string) ?? ""}
          onChange={(v) => setField(block, "agentId", v, onChange)}
          options={[{ value: "", label: "— choose an agent —" }, ...agents.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))]}
        />
      ) : (
        <FieldText
          label="Agent ID"
          help="UUID of the agent to wake"
          value={(cfg.agentId as string) ?? ""}
          onChange={(v) => setField(block, "agentId", v, onChange)}
          mono
        />
      )}
      <FieldText
        label="Reason"
        help="Reported in the run trace (default: workflow_triggered)"
        value={(cfg.reason as string) ?? ""}
        onChange={(v) => setField(block, "reason", v, onChange)}
      />
      <FieldText
        label="Task ID (optional)"
        help="If set, wake the agent on this specific task"
        value={(cfg.taskId as string) ?? ""}
        onChange={(v) => setField(block, "taskId", v, onChange)}
        mono
      />
    </>
  );
}

function QueryDatabaseForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { table?: string; where?: Record<string, unknown>; columns?: string[]; limit?: number; orderBy?: string };
  return (
    <>
      <FieldText
        label="Table"
        help="Must be a tenant-scoped table (tenant_id column required)"
        value={(cfg.table as string) ?? ""}
        onChange={(v) => setField(block, "table", v, onChange)}
        mono
      />
      <FieldJSON
        label="Where"
        help={`{ "col": "value" } for equality, { "col": ["a","b"] } for IN, { "col": null } for IS NULL`}
        value={cfg.where ?? {}}
        onChange={(v) => setField(block, "where", v, onChange)}
        rows={3}
      />
      <FieldText
        label="Columns (comma-separated, blank for all)"
        value={Array.isArray(cfg.columns) ? cfg.columns.join(", ") : ""}
        onChange={(v) => {
          const list = v.split(",").map((s) => s.trim()).filter(Boolean);
          setField(block, "columns", list.length > 0 ? list : undefined, onChange);
        }}
        mono
      />
      <FieldNumber
        label="Limit"
        value={cfg.limit}
        onChange={(v) => setField(block, "limit", v, onChange)}
      />
      <FieldText
        label="Order by (optional column)"
        value={(cfg.orderBy as string) ?? ""}
        onChange={(v) => setField(block, "orderBy", v, onChange)}
        mono
      />
    </>
  );
}

function UpdateRowForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { table?: string; where?: Record<string, unknown>; set?: Record<string, unknown> };
  return (
    <>
      <FieldText
        label="Table"
        value={(cfg.table as string) ?? ""}
        onChange={(v) => setField(block, "table", v, onChange)}
        mono
      />
      <FieldJSON
        label="Where (required)"
        help="Must match at least one row — no bare mass updates allowed"
        value={cfg.where ?? {}}
        onChange={(v) => setField(block, "where", v, onChange)}
        rows={3}
      />
      <FieldJSON
        label="Set"
        help={`{ "column": "new value" }`}
        value={cfg.set ?? {}}
        onChange={(v) => setField(block, "set", v, onChange)}
        rows={3}
      />
    </>
  );
}

function CreateTaskForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as {
    title?: string; description?: string; originKind?: string; priority?: string;
    assigneeAgentId?: string; assigneeUserId?: string; parentId?: string; proposedParams?: Record<string, unknown>;
  };
  return (
    <>
      <FieldText label="Title" value={(cfg.title as string) ?? ""} onChange={(v) => setField(block, "title", v, onChange)} />
      <FieldTextarea label="Description" value={(cfg.description as string) ?? ""} onChange={(v) => setField(block, "description", v, onChange)} rows={2} />
      <FieldSelect
        label="Origin kind"
        value={(cfg.originKind as string) ?? "workflow"}
        onChange={(v) => setField(block, "originKind", v, onChange)}
        options={[
          { value: "workflow",       label: "workflow (default)" },
          { value: "agent_action",   label: "agent_action (shows in Actions queue)" },
          { value: "human_todo",     label: "human_todo (shows in Actions queue)" },
          { value: "agent_blocked",  label: "agent_blocked" },
        ]}
      />
      <FieldSelect
        label="Priority"
        value={(cfg.priority as string) ?? "medium"}
        onChange={(v) => setField(block, "priority", v, onChange)}
        options={[
          { value: "low", label: "low" }, { value: "medium", label: "medium" },
          { value: "high", label: "high" }, { value: "urgent", label: "urgent" },
        ]}
      />
      <FieldText label="Assignee agent ID (optional)" value={(cfg.assigneeAgentId as string) ?? ""} onChange={(v) => setField(block, "assigneeAgentId", v, onChange)} mono />
      <FieldText label="Assignee user ID (optional)" value={(cfg.assigneeUserId as string) ?? ""} onChange={(v) => setField(block, "assigneeUserId", v, onChange)} mono />
    </>
  );
}

function WaitForHumanForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as {
    title?: string; description?: string; originKind?: string; priority?: string;
    assigneeUserId?: string; proposedParams?: Record<string, unknown>;
  };
  return (
    <>
      <FieldText label="Card title" help="Shown in the Actions queue" value={(cfg.title as string) ?? ""} onChange={(v) => setField(block, "title", v, onChange)} />
      <FieldTextarea label="Description" value={(cfg.description as string) ?? ""} onChange={(v) => setField(block, "description", v, onChange)} />
      <FieldSelect
        label="Card kind"
        value={(cfg.originKind as string) ?? "agent_action"}
        onChange={(v) => setField(block, "originKind", v, onChange)}
        options={[
          { value: "agent_action",  label: "agent_action (approve / edit & run)" },
          { value: "human_todo",    label: "human_todo (mark done)" },
          { value: "agent_blocked", label: "agent_blocked (comment to unblock)" },
        ]}
      />
      <FieldText label="Assignee user ID (optional)" value={(cfg.assigneeUserId as string) ?? ""} onChange={(v) => setField(block, "assigneeUserId", v, onChange)} mono />
      <FieldJSON
        label="Proposed params (edit & run form)"
        help={`Additional fields the user will see when editing. After resume, downstream blocks can access via {{${block.name}.userInput.field}}.`}
        value={cfg.proposedParams ?? {}}
        onChange={(v) => setField(block, "proposedParams", v, onChange)}
        rows={4}
      />
    </>
  );
}

function EmitEventForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { connectorKind?: string; eventType?: string; data?: Record<string, unknown> };
  return (
    <>
      <FieldText label="Connector kind" value={(cfg.connectorKind as string) ?? ""} onChange={(v) => setField(block, "connectorKind", v, onChange)} mono />
      <FieldText label="Event type" help="e.g. inbox.item_created, custom.event" value={(cfg.eventType as string) ?? ""} onChange={(v) => setField(block, "eventType", v, onChange)} mono />
      <FieldJSON label="Data" value={cfg.data ?? {}} onChange={(v) => setField(block, "data", v, onChange)} rows={3} />
    </>
  );
}

function InvokeWorkflowForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { workflowId?: string; payload?: Record<string, unknown> | string; triggerType?: string };
  // Load the workflow list once so the user can pick from a dropdown
  // instead of pasting a UUID. We dedupe out the current workflow so
  // users can't accidentally self-invoke (the engine also guards it).
  const workflows = useWorkflows();
  const options = (workflows.data?.workflows ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.id.slice(0, 8)})` }));
  return (
    <>
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-text-tertiary font-semibold mb-0.5">Workflow</span>
        <select
          value={(cfg.workflowId as string) ?? ""}
          onChange={(e) => setField(block, "workflowId", e.target.value, onChange)}
          className="w-full text-sm border border-border rounded px-2 py-1 bg-bg"
        >
          <option value="">— pick a workflow —</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="block text-[10px] text-text-tertiary mt-0.5">The workflow to run as a sub-routine. Its block outputs are merged into this block's output.</span>
      </label>
      <FieldText label="Trigger type" help="Defaults to 'manual'. Use 'event' / 'cron' etc. to match the child's trigger." value={(cfg.triggerType as string) ?? ""} onChange={(v) => setField(block, "triggerType", v, onChange)} mono />
      <FieldJSON label="Payload" help="Trigger payload passed to the child. Template strings are resolved first." value={typeof cfg.payload === "object" && cfg.payload !== null ? cfg.payload as Record<string, unknown> : {}} onChange={(v) => setField(block, "payload", v, onChange)} rows={4} />
    </>
  );
}

function CreateInboxItemForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  const cfg = block.config as { source?: string; subject?: string; body?: string; from?: string; items?: unknown };
  return (
    <>
      <FieldText label="Source" help="e.g. gmail, slack, workflow" value={(cfg.source as string) ?? ""} onChange={(v) => setField(block, "source", v, onChange)} mono />
      <FieldText label="Subject" value={(cfg.subject as string) ?? ""} onChange={(v) => setField(block, "subject", v, onChange)} />
      <FieldTextarea label="Body" value={(cfg.body as string) ?? ""} onChange={(v) => setField(block, "body", v, onChange)} rows={2} />
      <FieldText label="From" value={(cfg.from as string) ?? ""} onChange={(v) => setField(block, "from", v, onChange)} />
      <FieldText label="Items template (batch mode)" help="e.g. {{fetch.messages}} — each element becomes its own inbox item" value={(cfg.items as string) ?? ""} onChange={(v) => setField(block, "items", v, onChange)} mono />
    </>
  );
}

function JSONFallbackForm({ block, onChange }: { block: WorkflowBlock; onChange: BlockConfigFormProps["onChange"] }) {
  return (
    <FieldJSON
      label="Config"
      help="Raw JSON — no dedicated form for this block type yet"
      value={block.config}
      onChange={(v) => onChange({ config: v as Record<string, unknown> })}
      rows={8}
    />
  );
}

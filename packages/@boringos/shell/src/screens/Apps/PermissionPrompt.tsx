// SPDX-License-Identifier: BUSL-1.1
//
// Minimal permission prompt — A7's local version. C7 will replace this
// with a canonical component at packages/@boringos/shell/src/components/
// PermissionPrompt.tsx that's also reused by direct-from-URL installs.
//
// Renders the install-time consent: the requested capability scopes
// grouped by category (Data / Agents & Workflows / UI / Integrations /
// Memory), publisher trust signal, and approve/cancel buttons.

import type { Manifest } from "@boringos/app-sdk";

const CATEGORY_RULES: Array<{ label: string; matches: (cap: string) => boolean }> = [
  { label: "Data", matches: (c) => c.startsWith("entities.") },
  {
    label: "Agents & Workflows",
    matches: (c) =>
      c.startsWith("agents.") ||
      c.startsWith("agents:") ||
      c.startsWith("workflows.") ||
      c.startsWith("workflows:") ||
      c.startsWith("events:"),
  },
  {
    label: "UI",
    matches: (c) => c.startsWith("slots:") || c.startsWith("actions:expose"),
  },
  {
    label: "Integrations",
    matches: (c) =>
      c.startsWith("connectors") ||
      c.startsWith("auth:") ||
      c.startsWith("network:") ||
      c.startsWith("webhooks:"),
  },
  {
    label: "Inbox",
    matches: (c) => c.startsWith("inbox:"),
  },
  {
    label: "Memory",
    matches: (c) => c.startsWith("memory:"),
  },
];

function groupCapabilities(caps: string[]): { label: string; items: string[] }[] {
  const groups = CATEGORY_RULES.map((r) => ({ label: r.label, items: [] as string[] }));
  const other: string[] = [];
  for (const cap of caps) {
    let placed = false;
    for (let i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_RULES[i]!.matches(cap)) {
        groups[i]!.items.push(cap);
        placed = true;
        break;
      }
    }
    if (!placed) other.push(cap);
  }
  if (other.length > 0) groups.push({ label: "Other", items: other });
  return groups.filter((g) => g.items.length > 0);
}

export interface PermissionPromptProps {
  manifest: Manifest;
  /** "marketplace" trusts publisher.verified; "github-direct" always shows the unverified warning. */
  source: "marketplace" | "github-direct";
  onApprove: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function PermissionPrompt({
  manifest,
  source,
  onApprove,
  onCancel,
  busy,
}: PermissionPromptProps) {
  const verified = manifest.publisher.verified === true && source === "marketplace";
  const groups = groupCapabilities(manifest.capabilities);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            {manifest.name}
          </h3>
          <div className="text-xs text-slate-500 mt-0.5">
            {manifest.publisher.name}
            {verified && (
              <span className="ml-2 text-emerald-700 font-medium">verified</span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          v{manifest.version}
        </span>
      </div>

      {!verified && source === "github-direct" && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Unverified publisher. Install only if you trust this source.
        </div>
      )}

      <p className="text-sm text-slate-600 mb-4">
        This {manifest.kind} requests permission to:
      </p>

      <div className="space-y-3 mb-6 max-h-72 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              {g.label}
            </div>
            <ul className="space-y-1">
              {g.items.map((cap) => (
                <li
                  key={cap}
                  className="text-xs text-slate-700 font-mono pl-3 border-l-2 border-slate-100"
                >
                  {cap}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Installing…" : "Install"}
        </button>
      </div>
    </div>
  );
}

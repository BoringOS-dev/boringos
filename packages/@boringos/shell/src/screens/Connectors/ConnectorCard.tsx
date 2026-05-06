// SPDX-License-Identifier: BUSL-1.1
//
// Per-connector card for the Connectors screen. Presentational only —
// no fetches, no client awareness. Parent owns the API + actions.

import type { ConnectorViewModel, NormalizedStatus } from "./connectorsPresenter.js";

const STATUS_BADGE: Record<NormalizedStatus, string> = {
  connected: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  expired: "bg-amber-50 text-amber-800 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
  not_connected: "bg-slate-50 text-slate-500 ring-slate-200",
};

export interface ConnectorCardProps {
  vm: ConnectorViewModel;
  onAdd: (kind: string) => void;
  onDisconnect: (kind: string) => void;
  onReconnect: (kind: string) => void;
}

export function ConnectorCard({
  vm,
  onAdd,
  onDisconnect,
  onReconnect,
}: ConnectorCardProps) {
  return (
    <li
      data-testid="connector-card"
      data-kind={vm.kind}
      data-status={vm.status}
      className="rounded-lg border border-slate-200 bg-white p-4 flex items-start gap-4"
    >
      <div className="w-10 h-10 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold shrink-0">
        {vm.name.charAt(0).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-slate-900 truncate">
            {vm.name}
          </h3>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ${STATUS_BADGE[vm.status]}`}
          >
            {vm.statusLabel}
          </span>
        </div>
        {vm.description && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {vm.description}
          </p>
        )}
        {vm.lastSyncLabel && (
          <p className="text-[11px] text-slate-400 mt-1">
            Last sync {vm.lastSyncLabel}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {vm.status === "not_connected" && (
          <button
            type="button"
            onClick={() => onAdd(vm.kind)}
            disabled={!vm.canAdd}
            title={
              vm.canAdd
                ? `Connect ${vm.name}`
                : `${vm.name} does not support OAuth`
            }
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
          >
            Add
          </button>
        )}
        {vm.status === "expired" && (
          <button
            type="button"
            onClick={() => onReconnect(vm.kind)}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700"
          >
            Reconnect
          </button>
        )}
        {(vm.status === "connected" ||
          vm.status === "expired" ||
          vm.status === "error") && (
          <button
            type="button"
            onClick={() => onDisconnect(vm.kind)}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100"
          >
            Disconnect
          </button>
        )}
      </div>
    </li>
  );
}

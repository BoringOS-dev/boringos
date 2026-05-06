// SPDX-License-Identifier: BUSL-1.1
//
// Add-connector wizard modal (N4). Generic — driven entirely by the
// connector manifest data flowing through ConnectorViewModel. Hits the
// signed authorize endpoint (N2) when the user confirms.

import { useEffect } from "react";
import {
  humanizeScope,
  type ConnectorViewModel,
} from "./connectorsPresenter.js";

export interface AddConnectorModalProps {
  vm: ConnectorViewModel;
  onConfirm: (kind: string) => void;
  onCancel: () => void;
}

export function AddConnectorModal({
  vm,
  onConfirm,
  onCancel,
}: AddConnectorModalProps) {
  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="add-connector-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            Connect {vm.name}
          </h2>
          {vm.description && (
            <p className="text-xs text-slate-500 mt-1">{vm.description}</p>
          )}
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-700 uppercase tracking-wide">
            You'll be granting access to
          </p>
          {vm.oauthScopes.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              This connector handles its scopes internally.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {vm.oauthScopes.map((scope) => (
                <li
                  key={scope}
                  className="text-sm text-slate-700 flex items-start gap-2"
                  title={scope}
                >
                  <span className="text-slate-400 leading-5">·</span>
                  <span className="font-mono text-xs">
                    {humanizeScope(scope)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            You'll be redirected to {vm.name} to confirm. We never see your
            password — only the access token they hand back.
          </p>
        </div>

        <div className="px-5 pb-5 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(vm.kind)}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
          >
            Authorize
          </button>
        </div>
      </div>
    </div>
  );
}

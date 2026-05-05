// SPDX-License-Identifier: BUSL-1.1
//
// Installed tab — lists what the InstallRuntime currently has. Drives
// the live demo of the slot registry: installing/uninstalling here
// (once the install pipeline lands in C5) updates this list immediately
// via the registry's subscribe.

import { useEffect, useState } from "react";

import { installRuntime } from "../../runtime/install-runtime.js";
import type { InstalledAppRecord } from "../../runtime/install-runtime.js";

export function Installed() {
  const [records, setRecords] = useState<InstalledAppRecord[]>(() =>
    installRuntime.list(),
  );

  useEffect(() => {
    // Subscribe to the underlying registry so install/uninstall events
    // refresh the list without a page reload.
    const off = installRuntime.getRegistry().subscribe(() => {
      setRecords(installRuntime.list());
    });
    return off;
  }, []);

  if (records.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">No apps installed.</p>
        <p className="text-xs text-slate-400 mt-2">
          Install one from Browse, or paste a GitHub URL in the next tab.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {records.map((r) => (
        <li key={r.appId} className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">{r.appId}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              v{r.version} · installed {r.installedAt.toLocaleDateString()}
            </div>
          </div>
          <button
            type="button"
            disabled
            title="Uninstall lands in C6"
            className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 cursor-not-allowed"
          >
            Uninstall
          </button>
        </li>
      ))}
    </ul>
  );
}

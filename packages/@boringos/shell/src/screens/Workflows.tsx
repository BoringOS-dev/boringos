// SPDX-License-Identifier: BUSL-1.1
//
// Workflows — minimal list. The full DAG editor lives in
// @boringos/workflow-ui (xyflow + dagre). Pulling that into the shell
// is heavier than v1 needs — for now we list workflows via the admin
// API directly and link out for editing.

import { useEffect, useState } from "react";
import { useClient } from "@boringos/ui";

import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "./_shared.js";

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  type?: string;
  enabled?: boolean;
}

export function Workflows() {
  const client = useClient();
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkflows(null);
    setError(null);

    const baseUrl =
      (client as unknown as { config?: { url?: string } }).config?.url ?? "";
    const headers: Record<string, string> = {};
    const cfg = (client as unknown as { config?: Record<string, unknown> })
      .config;
    if (cfg?.token) headers["Authorization"] = `Bearer ${cfg.token}`;
    if (cfg?.tenantId) headers["X-Tenant-Id"] = String(cfg.tenantId);

    fetch(`${baseUrl}/api/admin/workflows`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.workflows ?? []);
        setWorkflows(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <>
      <ScreenHeader
        title="Workflows"
        subtitle="DAG-based orchestration"
      />
      <ScreenBody>
        {error ? (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <div className="font-medium">Couldn't load workflows.</div>
            <div className="text-xs mt-1 font-mono">{error}</div>
          </div>
        ) : !workflows ? (
          <LoadingState />
        ) : workflows.length === 0 ? (
          <EmptyState
            title="No workflows yet"
            description="Workflows orchestrate multi-step, multi-agent work. Apps can ship workflow templates that install at tenant provision."
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {workflows.map((wf) => (
              <li key={wf.id} className="px-4 py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">
                    {wf.name}
                  </div>
                  {wf.description && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {wf.description}
                    </p>
                  )}
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    wf.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {wf.enabled ? "enabled" : "disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>
    </>
  );
}

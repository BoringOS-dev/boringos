// SPDX-License-Identifier: BUSL-1.1
//
// Agents — list view via @boringos/ui's useAgents().

import { useState } from "react";
import { useAgents } from "@boringos/ui";

import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "./_shared.js";

export function Agents() {
  const { agents, isLoading, wakeAgent } = useAgents();
  const [wakingAgentId, setWakingAgentId] = useState<string | null>(null);

  const handleWakeAgent = async (agentId: string) => {
    setWakingAgentId(agentId);
    try {
      await wakeAgent({ agentId });
    } finally {
      setWakingAgentId(null);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Agents"
        subtitle="The cabinet"
      />
      <ScreenBody>
        {isLoading ? (
          <LoadingState />
        ) : !agents || agents.length === 0 ? (
          <EmptyState
            title="No agents yet"
            description="Install an app to seed agents, or create one from the API. The framework ships 12 personas and 6 runtime adapters."
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {agents.map((agent) => (
              <li key={agent.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold shrink-0">
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">
                    {agent.name}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {(agent as { persona?: string }).persona ?? "—"} ·{" "}
                    {(agent as { runtime?: string }).runtime ?? "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">
                    {(agent as { status?: string }).status ?? "idle"}
                  </span>
                  <button
                    onClick={() => handleWakeAgent(agent.id)}
                    disabled={wakingAgentId === agent.id}
                    className="px-3 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {wakingAgentId === agent.id ? "Waking..." : "Wake"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>
    </>
  );
}

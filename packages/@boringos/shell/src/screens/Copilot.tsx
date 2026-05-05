// SPDX-License-Identifier: BUSL-1.1
//
// Copilot — minimal placeholder showing the available copilot tools
// contributed by installed apps via useSlot("copilotTools"). Real
// thread-based conversation UI lands in a follow-up task; for v1 the
// screen just confirms the slot wiring works.

import { useSlot } from "../slots/context.js";
import { EmptyState, ScreenBody, ScreenHeader } from "./_shared.js";

export function Copilot() {
  const tools = useSlot("copilotTools");

  return (
    <>
      <ScreenHeader
        title="Copilot"
        subtitle="Always-on agentic thread"
      />
      <ScreenBody>
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-500">
            Conversation UI lands in a follow-up. The Cmd+K bar at the bottom
            is the entry point for now.
          </p>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Available tools
          </h2>
          {tools.length === 0 ? (
            <EmptyState
              title="No tools yet"
              description="Apps you install can register copilot tools — actions the copilot can invoke during a conversation."
            />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {tools.map((t) => (
                <li
                  key={`${t.appId}/${t.slotId}`}
                  className="px-4 py-3 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 font-mono">
                      {t.slot.name}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {t.slot.description}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {t.appId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScreenBody>
    </>
  );
}

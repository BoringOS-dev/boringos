// SPDX-License-Identifier: BUSL-1.1
//
// Tasks — list view via @boringos/ui's useTasks().

import { useState } from "react";
import { useTasks } from "@boringos/ui";

import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "./_shared.js";

const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
type Status = (typeof STATUSES)[number];

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

export function Tasks() {
  // Default to "todo" — what the user actually needs to act on.
  // "all" moves to the end of the tab strip as the catch-all view.
  const [status, setStatus] = useState<Status | "all">("todo");
  const filters = status === "all" ? undefined : { status };
  const { tasks, isLoading } = useTasks(filters);

  return (
    <>
      <ScreenHeader
        title="Tasks"
        subtitle="Work assigned to humans and agents"
        actions={
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
            {([...STATUSES, "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-2.5 py-1 text-xs rounded ${
                  status === s
                    ? "bg-slate-100 text-slate-900 font-medium"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        }
      />
      <ScreenBody>
        {isLoading ? (
          <LoadingState />
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Tasks are created by you, by agents, or by workflows."
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {tasks.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {task.title}
                    </div>
                    {task.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.priority && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          PRIORITY_COLORS[task.priority] ??
                          "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {task.priority}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono">
                      {task.status}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>
    </>
  );
}

// SPDX-License-Identifier: BUSL-1.1
//
// Per-tab empty state for Tasks. The default empty list is a teaching
// moment — celebrate when there's nothing waiting, point users to the
// next thing to do otherwise.

import { Link } from "react-router-dom";

import { EmptyState } from "../_shared.js";
import type { TaskTab } from "./presenter.js";

export function TaskEmptyState({ tab }: { tab: TaskTab }) {
  switch (tab) {
    case "my-todos":
      return (
        <EmptyState
          title="Inbox zero on tasks too."
          description="Nothing waiting on you right now. Watch agents work, or send a message in Copilot to delegate something."
          cta={
            <Link
              to="/copilot"
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Open Copilot
            </Link>
          }
        />
      );
    case "watching":
      return (
        <EmptyState
          title="Nothing in flight."
          description="When you ask an agent to do something, it'll show up here while it's working."
        />
      );
    case "done":
      return (
        <EmptyState
          title="No completed tasks yet."
          description="Tasks you finish or that agents finish for you in the last 30 days will land here."
        />
      );
    case "system":
      return (
        <EmptyState
          title="No automated tasks."
          description="Connect a connector under Connectors to start ingesting work — emails to triage, messages to draft, etc."
          cta={
            <Link
              to="/connectors"
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Open Connectors
            </Link>
          }
        />
      );
    case "all":
    default:
      return (
        <EmptyState
          title="No tasks yet."
          description="Tasks are created by you, by agents, or by workflows."
        />
      );
  }
}

// SPDX-License-Identifier: BUSL-1.1
//
// Inbox — unified stream of items via @boringos/ui's useInbox().
// One inbox item per source event (per the shell-screens.md ownership
// rule). Apps enrich items via inbox.handler slots — that integration
// lands when the install pipeline (C5) wires slot dispatch.

import { useState } from "react";
import { useInbox } from "@boringos/ui";

import { EmptyState, LoadingState, ScreenBody, ScreenHeader } from "./_shared.js";

const STATUSES = ["unread", "read", "snoozed", "archived"] as const;
type Status = (typeof STATUSES)[number];

export function Inbox() {
  const [status, setStatus] = useState<Status>("unread");
  const query = useInbox(status);
  const items = query.data as
    | Array<{ id: string; source: string; subject?: string; from?: string; body?: string }>
    | undefined;
  const isLoading = query.isLoading;

  return (
    <>
      <ScreenHeader
        title="Inbox"
        subtitle="Unified stream from connectors and apps"
        actions={
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
            {STATUSES.map((s) => (
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
                {s}
              </button>
            ))}
          </div>
        }
      />
      <ScreenBody>
        {query.error ? (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <div className="font-medium">Couldn't load inbox.</div>
            <div className="text-xs mt-1 font-mono">
              {query.error instanceof Error
                ? query.error.message
                : String(query.error)}
            </div>
          </div>
        ) : isLoading ? (
          <LoadingState />
        ) : !items || items.length === 0 ? (
          <EmptyState
            title={`No ${status} items`}
            description="Connect Gmail or Slack from the Connectors screen to start receiving."
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {item.subject ?? "(no subject)"}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      {item.from ?? "(unknown sender)"} · {item.source}
                    </div>
                  </div>
                </div>
                {item.body && (
                  <p className="mt-2 text-xs text-slate-600 line-clamp-2">
                    {item.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>
    </>
  );
}

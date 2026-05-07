// SPDX-License-Identifier: BUSL-1.1
//
// Inbox list pane — scrollable rows with subject / sender / time /
// snippet. Phase A1 baseline; A3 layers on triage chips + score, A6
// collapses by thread.

import type { InboxItem } from "@boringos/ui";

import { LoadingState, EmptyState } from "../_shared.js";
import { formatRelativeTime, parseSenderName, snippetFrom } from "./presenter.js";

export interface InboxListProps {
  items: InboxItem[];
  isLoading: boolean;
  status: string;
  selectedId: string | null;
  onSelect: (item: InboxItem) => void | Promise<void>;
}

export function InboxList({ items, isLoading, status, selectedId, onSelect }: InboxListProps) {
  if (isLoading) {
    return <LoadingState />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={`No ${status} items`}
        description="Connect Gmail or Slack from Connectors to start receiving."
      />
    );
  }

  return (
    <ul className="overflow-auto divide-y divide-slate-100">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const unread = item.status === "unread";
        return (
          <li
            key={item.id}
            data-testid="inbox-row"
            data-id={item.id}
            data-selected={selected ? "true" : "false"}
            data-unread={unread ? "true" : "false"}
            onClick={() => void onSelect(item)}
            className={`px-4 py-3 cursor-pointer border-l-2 ${
              selected
                ? "bg-blue-50/60 border-blue-500"
                : "border-transparent hover:bg-slate-50"
            }`}
          >
            <div className="flex items-start gap-2">
              {/* Unread indicator */}
              <span
                className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  unread ? "bg-blue-500" : "bg-transparent"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-sm truncate ${
                      unread ? "font-semibold text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {parseSenderName(item.from)}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                <div
                  className={`text-xs truncate mt-0.5 ${
                    unread ? "text-slate-800" : "text-slate-600"
                  }`}
                >
                  {item.subject || "(no subject)"}
                </div>
                {item.body && (
                  <p className="text-[11px] text-slate-500 truncate mt-1">
                    {snippetFrom(item.body)}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

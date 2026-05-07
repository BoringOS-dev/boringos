// SPDX-License-Identifier: BUSL-1.1
//
// Inbox list pane — scrollable rows with subject / sender / time /
// snippet. Phase A1 baseline; A3 layers on triage chips + score, A6
// collapses by thread.

import type { InboxItem } from "@boringos/ui";

import { LoadingState, EmptyState } from "../_shared.js";
import {
  classificationChipClass,
  countDrafts,
  formatRelativeTime,
  parseSenderName,
  readTriage,
  scoreDotClass,
  scoreTier,
  snippetFrom,
  type Thread,
} from "./presenter.js";
import { formatWakeIn } from "./snooze.js";

export interface InboxListProps {
  threads: Thread<InboxItem>[];
  isLoading: boolean;
  status: string;
  selectedId: string | null;
  /** Set of thread-latest item IDs included in the bulk selection. */
  bulkSelected: Set<string>;
  onSelect: (item: InboxItem, modifiers: { meta: boolean; shift: boolean }) => void | Promise<void>;
}

export function InboxList({ threads, isLoading, status, selectedId, bulkSelected, onSelect }: InboxListProps) {
  if (isLoading) {
    return <LoadingState />;
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        title={`No ${status} items`}
        description="Connect Gmail or Slack from Connectors to start receiving."
      />
    );
  }

  return (
    <ul className="overflow-auto divide-y divide-slate-100">
      {threads.map((thread) => {
        const item = thread.latest;
        const threadCount = thread.items.length;
        const selected = item.id === selectedId;
        const inBulk = bulkSelected.has(item.id);
        // Thread is "unread" if any message in it is unread.
        const unread = thread.items.some((i) => i.status === "unread");
        const triage = readTriage(item);
        const drafts = countDrafts(item);
        const tier = triage ? scoreTier(triage.score) : null;
        return (
          <li
            key={item.id}
            data-testid="inbox-row"
            data-id={item.id}
            data-selected={selected ? "true" : "false"}
            data-unread={unread ? "true" : "false"}
            data-in-bulk={inBulk ? "true" : "false"}
            onClick={(e) =>
              void onSelect(item, {
                meta: e.metaKey || e.ctrlKey,
                shift: e.shiftKey,
              })
            }
            className={`px-4 py-3 cursor-pointer border-l-2 ${
              inBulk
                ? "bg-blue-100/80 border-blue-600"
                : selected
                  ? "bg-blue-50/60 border-blue-500"
                  : "border-transparent hover:bg-slate-50"
            }`}
          >
            <div className="flex items-start gap-2">
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
                    {threadCount > 1 && (
                      <span className="ml-1 text-[10px] text-slate-400 font-normal tabular-nums">
                        ({threadCount})
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
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
                {/* Snoozed badge — shown only on the snoozed tab */}
                {item.status === "snoozed" && item.snoozeUntil && (
                  <p className="text-[10px] text-amber-700 mt-1">
                    Wakes {formatWakeIn(item.snoozeUntil)}
                  </p>
                )}
                {/* Triage chip + score + drafts indicator row */}
                {(triage || drafts > 0) && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {triage && (
                      <span
                        className={`text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 ${classificationChipClass(triage.classification)}`}
                        title={triage.rationale || undefined}
                      >
                        {triage.classification}
                      </span>
                    )}
                    {triage && tier && (
                      <span
                        className="flex items-center gap-1 text-[10px] text-slate-500 tabular-nums"
                        title={`Score ${triage.score} — ${triage.rationale || ""}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${scoreDotClass(tier)}`} />
                        {triage.score}
                      </span>
                    )}
                    {drafts > 0 && (
                      <span
                        className="text-[10px] text-slate-500 flex items-center gap-0.5"
                        title={`${drafts} reply draft${drafts === 1 ? "" : "s"} ready`}
                      >
                        ✏ {drafts}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

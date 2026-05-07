// SPDX-License-Identifier: BUSL-1.1
//
// Inbox detail pane — shows the selected thread. Older messages
// collapse to one-line summaries that expand on click; the latest
// message is always expanded so the user lands on what's most likely
// the actionable item. Reply drafts + triage card sit above the
// thread; both are tied to the latest item (since that's what triage
// + replier agents have processed).

import { useState } from "react";
import type { InboxItem } from "@boringos/ui";

import { ActionToolbar } from "./ActionToolbar.js";
import { EmailBody } from "./EmailBody.js";
import { ReplyDrafts } from "./ReplyDrafts.js";
import { TriageClassificationMenu } from "./TriageClassificationMenu.js";
import {
  formatAbsoluteTime,
  parseSenderName,
  readDrafts,
  readTriage,
  scoreDotClass,
  scoreTier,
  type Classification,
  type ReplyDraft,
  type Thread,
} from "./presenter.js";

function readBodyHtml(item: InboxItem): string | null {
  const m = item.metadata;
  if (!m || typeof m !== "object") return null;
  const html = (m as { bodyHtml?: unknown }).bodyHtml;
  return typeof html === "string" && html.length > 0 ? html : null;
}

export interface InboxDetailProps {
  thread: Thread<InboxItem> | null;
  /** A8 — opens the compose modal with the draft prefilled. */
  onUseDraft?: (item: InboxItem, draft: ReplyDraft) => void;
  /** Removes the draft from metadata.replyDrafts. */
  onDiscardDraft?: (item: InboxItem, draft: ReplyDraft) => void | Promise<void>;
  /** A8 — opens compose modal with no draft prefilled (or first draft if any). */
  onReply?: (item: InboxItem) => void;
  /** Flip the latest item back to status='unread'. */
  onMarkUnread?: (item: InboxItem) => void | Promise<void>;
  /** POST archive — vanishes from the current list. */
  onArchive?: (item: InboxItem) => void | Promise<void>;
  /** POST create-task — vanishes from inbox, lands in tasks. */
  onConvertToTask?: (item: InboxItem) => void | Promise<void>;
  /** Snooze: PATCH status + snoozeUntil. */
  onSnooze?: (item: InboxItem, until: Date) => void | Promise<void>;
  /** Override the agent-assigned triage classification. */
  onReclassify?: (item: InboxItem, next: Classification) => void | Promise<void>;
}

export function InboxDetail({
  thread,
  onUseDraft,
  onDiscardDraft,
  onReply,
  onMarkUnread,
  onArchive,
  onConvertToTask,
  onSnooze,
  onReclassify,
}: InboxDetailProps) {
  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-slate-500">Select an item to read.</p>
          <p className="text-xs text-slate-400 mt-1">
            Or press <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[10px] font-mono">j</kbd> /
            <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[10px] font-mono ml-1">k</kbd> to navigate (coming in B1).
          </p>
        </div>
      </div>
    );
  }

  const latest = thread.latest;
  const triage = readTriage(latest);
  const tier = triage ? scoreTier(triage.score) : null;
  const drafts = readDrafts(latest);

  return (
    <div className="flex-1 overflow-auto">
      <header className="sticky top-0 bg-white border-b border-slate-100 px-6 pt-5 pb-4 z-10">
        <h2 className="text-lg font-semibold text-slate-900 leading-tight">
          {latest.subject || "(no subject)"}
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{latest.from ?? "(unknown sender)"}</span>
          <span>·</span>
          <span>{formatAbsoluteTime(latest.createdAt)}</span>
          <span>·</span>
          <span className="font-mono text-[10px] text-slate-400">{latest.source}</span>
          {thread.items.length > 1 && (
            <>
              <span>·</span>
              <span className="text-[10px] text-slate-500">
                {thread.items.length} messages
              </span>
            </>
          )}
        </div>
        <ActionToolbar
          hasDrafts={drafts.length > 0}
          onReply={() => onReply?.(latest)}
          onMarkUnread={() => void onMarkUnread?.(latest)}
          onArchive={() => void onArchive?.(latest)}
          onConvertToTask={() => void onConvertToTask?.(latest)}
          onSnooze={(until) => void onSnooze?.(latest, until)}
        />
      </header>

      <div className="px-6 py-4 space-y-4">
        {/* Triage card — written by generic-triage agent on the latest item. */}
        {triage && (
          <section
            data-testid="triage-card"
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                Triage
              </span>
              <TriageClassificationMenu
                current={triage.classification}
                onSelect={(next) => void onReclassify?.(latest, next)}
              />
              {tier && (
                <span className="flex items-center gap-1 text-xs text-slate-600 tabular-nums">
                  <span className={`w-1.5 h-1.5 rounded-full ${scoreDotClass(tier)}`} />
                  Score {triage.score}
                </span>
              )}
              {triage.classifiedAt && (
                <span className="text-[10px] text-slate-400 ml-auto">
                  {formatAbsoluteTime(triage.classifiedAt)}
                </span>
              )}
            </div>
            {triage.rationale && (
              <p className="mt-1.5 text-xs text-slate-700 leading-relaxed">
                {triage.rationale}
              </p>
            )}
          </section>
        )}

        {/* Reply drafts. */}
        <ReplyDrafts
          drafts={drafts}
          onUseDraft={(d) => onUseDraft?.(latest, d)}
          onDiscardDraft={(d) => onDiscardDraft?.(latest, d)}
        />

        {/* Thread body: oldest → latest. Older messages collapsed by default. */}
        {thread.items.map((item, idx) => {
          const isLatest = idx === thread.items.length - 1;
          return (
            <ThreadMessage
              key={item.id}
              item={item}
              defaultExpanded={isLatest}
              showDivider={!isLatest}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ThreadMessageProps {
  item: InboxItem;
  defaultExpanded: boolean;
  showDivider: boolean;
}

function ThreadMessage({ item, defaultExpanded, showDivider }: ThreadMessageProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`w-full text-left rounded-md px-3 py-2 hover:bg-slate-50 ${
          showDivider ? "border-t border-slate-100" : ""
        }`}
      >
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium text-slate-700">
            {parseSenderName(item.from)}
          </span>
          <span className="text-slate-400">{formatAbsoluteTime(item.createdAt)}</span>
          <span className="text-slate-400 ml-auto">▾ Expand</span>
        </div>
      </button>
    );
  }

  return (
    <div className={showDivider ? "pt-3 border-t border-slate-100" : ""}>
      <div className="flex items-baseline gap-2 text-xs mb-2">
        <span className="font-medium text-slate-700">
          {parseSenderName(item.from)}
        </span>
        <span className="text-slate-400">{formatAbsoluteTime(item.createdAt)}</span>
        {showDivider && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            Collapse
          </button>
        )}
      </div>
      <EmailBody html={readBodyHtml(item)} text={item.body ?? null} />
    </div>
  );
}

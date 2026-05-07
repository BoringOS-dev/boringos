// SPDX-License-Identifier: BUSL-1.1
//
// Inbox detail pane — shows the selected item. Phase A1+A2 minimal
// version (subject, headers, body as plain text). Subsequent passes:
//   A3 — triage chip badge in header
//   A4 — DOMPurify + sandboxed iframe HTML render
//   A5 — Reply drafts cards
//   A6 — Threading (full thread render)
//   A7 — Action toolbar (mark unread / archive / convert)
//   A8 — Reply compose modal + Send via Gmail

import type { InboxItem } from "@boringos/ui";

import { formatAbsoluteTime } from "./presenter.js";

export interface InboxDetailProps {
  item: InboxItem | null;
}

export function InboxDetail({ item }: InboxDetailProps) {
  if (!item) {
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

  return (
    <div className="flex-1 overflow-auto">
      {/* Sticky header with subject + sender */}
      <header className="sticky top-0 bg-white border-b border-slate-100 px-6 pt-5 pb-4 z-10">
        <h2 className="text-lg font-semibold text-slate-900 leading-tight">
          {item.subject || "(no subject)"}
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{item.from ?? "(unknown sender)"}</span>
          <span>·</span>
          <span>{formatAbsoluteTime(item.createdAt)}</span>
          <span>·</span>
          <span className="font-mono text-[10px] text-slate-400">{item.source}</span>
        </div>
        {/* Action toolbar placeholder — A7 fills this in. */}
      </header>

      <div className="px-6 py-4">
        {/* Body — A4 swaps this for the sandboxed iframe HTML render. */}
        {item.body ? (
          <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
            {item.body}
          </pre>
        ) : (
          <p className="text-sm text-slate-400 italic">No body content.</p>
        )}
      </div>
    </div>
  );
}

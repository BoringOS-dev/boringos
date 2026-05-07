// SPDX-License-Identifier: BUSL-1.1
//
// Detail-pane action toolbar. Buttons are intentionally text-first
// (no icon-only) so the affordance is unambiguous; icons can be
// layered on later. Keyboard shortcuts on the same actions land in B1.

import { useEffect, useRef, useState } from "react";

import { SNOOZE_PRESETS } from "./snooze.js";

export interface ActionToolbarProps {
  hasDrafts: boolean;
  onReply: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onConvertToTask: () => void;
  onSnooze: (until: Date) => void;
  onSchedule?: () => void;
  /** Display when an action is in flight to avoid double-fire. */
  busy?: boolean;
}

export function ActionToolbar({
  hasDrafts,
  onReply,
  onMarkUnread,
  onArchive,
  onConvertToTask,
  onSnooze,
  onSchedule,
  busy,
}: ActionToolbarProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
  useEffect(() => {
    if (!snoozeOpen) return;
    function onDoc(e: MouseEvent) {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setSnoozeOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [snoozeOpen]);

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onReply}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        title={hasDrafts ? "Reply (a draft is ready)" : "Reply"}
      >
        Reply{hasDrafts ? " ✏" : ""}
      </button>
      <button
        type="button"
        onClick={onArchive}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        title="Archive (e)"
      >
        Archive
      </button>
      <div ref={snoozeRef} className="relative">
        <button
          type="button"
          onClick={() => setSnoozeOpen((v) => !v)}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          title="Snooze (s)"
        >
          Snooze ▾
        </button>
        {snoozeOpen && (
          <div className="absolute z-20 top-full left-0 mt-1 w-44 rounded-md bg-white shadow-lg ring-1 ring-slate-200 overflow-hidden">
            {SNOOZE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSnoozeOpen(false);
                  onSnooze(preset.resolve(new Date()));
                }}
                className="w-full text-left text-xs px-3 py-2 hover:bg-slate-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {onSchedule && (
        <button
          type="button"
          onClick={onSchedule}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          title="Schedule a meeting from this email"
        >
          🗓 Schedule
        </button>
      )}
      <button
        type="button"
        onClick={onMarkUnread}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        title="Mark unread (u)"
      >
        Mark unread
      </button>
      <button
        type="button"
        onClick={onConvertToTask}
        disabled={busy}
        className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        title="Convert to task (t)"
      >
        Convert to task
      </button>
    </div>
  );
}

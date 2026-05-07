// SPDX-License-Identifier: BUSL-1.1
//
// Inbox — two-pane layout (list + detail). Phase A1 + A2.
// A3-A8 build out triage chips, HTML rendering, threading, reply send.

import { useEffect, useState } from "react";
import { useInbox, useClient, type InboxItem } from "@boringos/ui";
import { useQueryClient } from "@tanstack/react-query";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { InboxList } from "./InboxList.js";
import { InboxDetail } from "./InboxDetail.js";

const STATUSES = ["unread", "read", "snoozed", "archived"] as const;
type Status = (typeof STATUSES)[number];

export function Inbox() {
  const [status, setStatus] = useState<Status>("unread");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useInbox(status);
  const items = (query.data as InboxItem[] | undefined) ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const client = useClient();
  const queryClient = useQueryClient();

  // Preselect the first item on initial load / status switch — fast
  // triage flow: open inbox, top item is right there.
  useEffect(() => {
    if (!selectedId && items.length > 0) {
      setSelectedId(items[0]!.id);
    }
    // If the currently selected item disappeared from the list (status
    // change after archive/etc), drop the selection or move to next.
    if (selectedId && !items.find((i) => i.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, status]);

  const handleSelect = async (item: InboxItem) => {
    setSelectedId(item.id);
    // Mark read on open. Optimistically — refetch in background so the
    // bold/dot indicator updates without a flash.
    if (item.status === "unread") {
      try {
        await client.updateInboxItem(item.id, { status: "read" });
        queryClient.invalidateQueries({ queryKey: ["inbox"] });
      } catch {
        // Non-fatal — the row still opens. Next refresh reconciles.
      }
    }
  };

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
                onClick={() => {
                  setStatus(s);
                  setSelectedId(null);
                }}
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
        ) : (
          <div className="flex h-full gap-3 -mt-2">
            <div className="w-[380px] shrink-0 border border-slate-200 rounded-lg bg-white overflow-hidden flex flex-col">
              <InboxList
                items={items}
                isLoading={query.isLoading}
                status={status}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </div>

            <div className="flex-1 border border-slate-200 rounded-lg bg-white overflow-hidden flex flex-col min-w-0">
              <InboxDetail item={selected} />
            </div>
          </div>
        )}
      </ScreenBody>
    </>
  );
}

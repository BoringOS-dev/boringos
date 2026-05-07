// SPDX-License-Identifier: BUSL-1.1
//
// Calendar screen — agenda view for the connected Google calendar.
// Reads live from Google on every open (no DB cache for v1; see
// docs/blockers/task_03 for the deferred reverse-sync approach).
// Two-pane: list of upcoming events on the left, detail on the right.

import { useEffect, useMemo, useState } from "react";
import { useClient } from "@boringos/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ScreenHeader, ScreenBody, EmptyState, LoadingState } from "./_shared.js";

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string; displayName?: string };
  status?: string;
}

const RANGE_DAYS = 14;

function rangeIso() {
  const now = new Date();
  const end = new Date(now.getTime() + RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { timeMin: now.toISOString(), timeMax: end.toISOString() };
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function startMs(e: CalEvent): number {
  const v = e.start?.dateTime ?? e.start?.date;
  return v ? new Date(v).getTime() : 0;
}

function isAllDay(e: CalEvent): boolean {
  return !!e.start?.date && !e.start?.dateTime;
}

function groupByDay(events: CalEvent[]): Array<{ day: string; date: Date; events: CalEvent[] }> {
  const buckets = new Map<string, { day: string; date: Date; events: CalEvent[] }>();
  for (const e of events) {
    const ms = startMs(e);
    if (!ms) continue;
    const d = new Date(ms);
    const key = d.toDateString();
    if (!buckets.has(key)) buckets.set(key, { day: formatDay(d), date: d, events: [] });
    buckets.get(key)!.events.push(e);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function Calendar() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["calendar", "list_events", "primary"],
    queryFn: async () => {
      const { timeMin, timeMax } = rangeIso();
      const result = await client.invokeAction("google", "list_events", {
        timeMin,
        timeMax,
        maxResults: 50,
      });
      if (!result.success) throw new Error(result.error ?? "Failed to load events");
      return ((result.data as { events?: CalEvent[] })?.events ?? []) as CalEvent[];
    },
  });

  const events = data ?? [];
  const grouped = useMemo(() => groupByDay(events), [events]);
  const selected = events.find((e) => e.id === selectedId) ?? null;

  // Auto-select the first upcoming event when the list lands.
  useEffect(() => {
    if (!selectedId && events.length > 0) setSelectedId(events[0]!.id);
  }, [events, selectedId]);

  const onCreated = async () => {
    setComposeOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Calendar"
        subtitle={`Next ${RANGE_DAYS} days`}
        actions={
          <>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              + New event
            </button>
          </>
        }
      />

      {error ? (
        <ScreenBody>
          <EmptyState
            title="Couldn't load calendar"
            description={
              error instanceof Error
                ? `${error.message}. Connect Google from Connectors if you haven't yet.`
                : "Something went wrong fetching events."
            }
          />
        </ScreenBody>
      ) : isLoading ? (
        <LoadingState />
      ) : events.length === 0 ? (
        <ScreenBody>
          <EmptyState
            title="Nothing on the calendar"
            description={`No events in the next ${RANGE_DAYS} days. Create one to get started.`}
          />
        </ScreenBody>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left — agenda list */}
          <ul className="w-96 overflow-auto border-r border-slate-100">
            {grouped.map((g) => (
              <li key={g.day}>
                <div className="sticky top-0 bg-slate-50 px-4 py-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide border-b border-slate-100">
                  {g.day}
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.events.map((e) => {
                    const start = e.start?.dateTime ? new Date(e.start.dateTime) : null;
                    const end = e.end?.dateTime ? new Date(e.end.dateTime) : null;
                    const isSel = e.id === selectedId;
                    return (
                      <li
                        key={e.id}
                        onClick={() => setSelectedId(e.id)}
                        className={`px-4 py-3 cursor-pointer border-l-2 ${
                          isSel
                            ? "bg-blue-50/60 border-blue-500"
                            : "border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {isAllDay(e)
                            ? "All day"
                            : start && end
                              ? `${formatTime(start)} – ${formatTime(end)}`
                              : "—"}
                        </div>
                        <div className="text-sm font-medium text-slate-900 truncate mt-0.5">
                          {e.summary || "(untitled event)"}
                        </div>
                        {e.attendees && e.attendees.length > 0 && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {e.attendees.length} attendee{e.attendees.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>

          {/* Right — detail */}
          <div className="flex-1 overflow-auto">
            {selected ? (
              <EventDetail event={selected} />
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <p className="text-sm text-slate-500">Select an event to read.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {composeOpen && (
        <NewEventModal onClose={() => setComposeOpen(false)} onCreated={onCreated} />
      )}
    </div>
  );
}

function EventDetail({ event }: { event: CalEvent }) {
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;

  return (
    <div className="px-6 py-5">
      <h2 className="text-lg font-semibold text-slate-900 leading-tight">
        {event.summary || "(untitled event)"}
      </h2>
      <div className="mt-2 text-xs text-slate-500 space-x-2">
        {isAllDay(event) ? (
          <span>All day, {formatDay(new Date(event.start!.date!))}</span>
        ) : start && end ? (
          <span>
            {formatDay(start)}, {formatTime(start)} – {formatTime(end)}
          </span>
        ) : null}
        {event.location && (
          <>
            <span>·</span>
            <span>{event.location}</span>
          </>
        )}
      </div>

      {event.hangoutLink && (
        <a
          href={event.hangoutLink}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
        >
          Join Meet
        </a>
      )}

      {event.description && (
        <section className="mt-5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Description
          </h3>
          <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
        </section>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Attendees ({event.attendees.length})
          </h3>
          <ul className="mt-1.5 space-y-1">
            {event.attendees.map((a) => (
              <li key={a.email} className="flex items-center gap-2 text-sm text-slate-800">
                <span className="text-slate-400">•</span>
                <span>{a.displayName || a.email}</span>
                {a.responseStatus && a.responseStatus !== "needsAction" && (
                  <span className="text-[10px] text-slate-500">
                    {a.responseStatus}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.htmlLink && (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block text-xs text-slate-500 hover:text-slate-900 underline"
        >
          Open in Google Calendar →
        </a>
      )}
    </div>
  );
}

interface NewEventModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewEventModal({ onClose, onCreated }: NewEventModalProps) {
  const client = useClient();
  // Default: tomorrow 10:00 AM, 30 minutes.
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }, []);
  const tomorrowEnd = useMemo(() => new Date(tomorrow.getTime() + 30 * 60_000), [tomorrow]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startStr, setStartStr] = useState(toDateTimeLocal(tomorrow));
  const [endStr, setEndStr] = useState(toDateTimeLocal(tomorrowEnd));
  const [attendeesStr, setAttendeesStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const attendees = attendeesStr
        .split(/[\s,]+/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.includes("@"));
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const result = await client.invokeAction("google", "create_event", {
        summary: title.trim(),
        description: description.trim() || undefined,
        startTime: new Date(startStr).toISOString(),
        endTime: new Date(endStr).toISOString(),
        timeZone: tz,
        attendees: attendees.length > 0 ? attendees : undefined,
      });
      if (!result.success) throw new Error(result.error ?? "Create failed");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl ring-1 ring-slate-200 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New event</h2>
        </header>

        <div className="px-5 py-4 space-y-3 overflow-auto">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className={INPUT_CLASS}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={busy}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="End">
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={busy}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Field label="Attendees (comma or whitespace separated)">
            <input
              type="text"
              value={attendeesStr}
              onChange={(e) => setAttendeesStr(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              disabled={busy}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={busy}
              className={`${INPUT_CLASS} font-sans`}
            />
          </Field>
          {error && (
            <div className="rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !startStr || !endStr}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "mt-1 w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function toDateTimeLocal(d: Date): string {
  // <input type="datetime-local"> wants "YYYY-MM-DDThh:mm" in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

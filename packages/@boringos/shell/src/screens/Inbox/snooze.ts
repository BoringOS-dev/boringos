// SPDX-License-Identifier: BUSL-1.1
//
// Pure helpers for snooze presets. The framework only stores
// snooze_until as a wall-clock timestamp — the preset names are a
// UX-only concept that's easy to swap or extend.

export interface SnoozePreset {
  /** Stable id for keyboard shortcuts / analytics. */
  id: string;
  label: string;
  /** Compute the absolute resume time given a "now". */
  resolve(now: Date): Date;
}

function nextNineAm(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function startOfNextWorkWeek(now: Date): Date {
  const d = new Date(now);
  // Move forward until we hit Monday 9 AM
  d.setHours(9, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1); // 1 = Monday
  return d;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { id: "1h", label: "1 hour", resolve: (now) => new Date(now.getTime() + 60 * 60_000) },
  { id: "4h", label: "4 hours", resolve: (now) => new Date(now.getTime() + 4 * 60 * 60_000) },
  { id: "tomorrow", label: "Tomorrow 9am", resolve: nextNineAm },
  { id: "next-week", label: "Next Monday 9am", resolve: startOfNextWorkWeek },
];

/**
 * Friendly relative phrasing of when a snoozed item wakes up:
 *   "in 47m" / "in 3h" / "tomorrow 9am" / "Mon 9am"
 */
export function formatWakeIn(
  raw: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "";
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;
  // Beyond a week: show date.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

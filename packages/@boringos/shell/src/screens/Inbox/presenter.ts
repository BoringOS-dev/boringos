// SPDX-License-Identifier: BUSL-1.1
//
// Pure helpers for the Inbox screen — kept separate from React so the
// formatting/parsing logic can be unit-tested without a jsdom harness
// (same pattern as Connectors/connectorsPresenter.ts).

/**
 * Compact relative-time string for list rows. Exact phrasing chosen so
 * the column never overflows ~36 px:
 *   "now" (<60 s)
 *   "Nm"  (1-59 min)
 *   "Nh"  (1-23 h)
 *   "Nd"  (1-6 d)
 *   "Mon 3"  (≥7 d, current year — abbreviated month + day)
 *   "May 3 2025"  (different year)
 */
export function formatRelativeTime(
  raw: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = now.getTime() - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (d.getFullYear() === now.getFullYear()) {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/**
 * Detail-pane absolute time. Includes weekday + time when within the
 * current week; else date + year.
 */
export function formatAbsoluteTime(
  raw: string | Date,
  now: Date = new Date(),
): string {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/**
 * Pull a display name out of an RFC-2822 `From:` value:
 *   `"Jordan Cohen" <jordan@cohenlee.example>` → `Jordan Cohen`
 *   `Jordan Cohen <jordan@…>`                  → `Jordan Cohen`
 *   `jordan@…`                                 → `jordan@…`
 *   null/undefined                             → `(unknown sender)`
 */
export function parseSenderName(raw: string | null | undefined): string {
  if (!raw) return "(unknown sender)";
  const trimmed = raw.trim();
  // Quoted name: "Display Name" <email>
  const quoted = /^"([^"]+)"\s*<.+>/.exec(trimmed);
  if (quoted && quoted[1]) return quoted[1].trim();
  // Bare name: Display Name <email>
  const bare = /^([^<]+?)\s*<.+>/.exec(trimmed);
  if (bare && bare[1]) return bare[1].trim();
  return trimmed;
}

/**
 * Single-line snippet for list rows. Strips any HTML tags, collapses
 * whitespace, drops Gmail's `>` quote markers, truncates to ~120 chars.
 */
export function snippetFrom(body: string, maxChars = 120): string {
  const stripped = body
    .replace(/<[^>]+>/g, " ") // strip HTML tags
    .replace(/^>.*$/gm, "")    // drop quoted lines (>)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= maxChars) return stripped;
  return stripped.slice(0, maxChars - 1).trimEnd() + "…";
}

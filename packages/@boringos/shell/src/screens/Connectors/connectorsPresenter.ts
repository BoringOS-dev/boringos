// SPDX-License-Identifier: BUSL-1.1
//
// Pure view-model helpers for the Connectors screen. Kept separate
// from the React component so the matrix of states (not_connected /
// connected / expired / error) can be tested by vitest without a
// jsdom harness.

export type NormalizedStatus =
  | "not_connected"
  | "connected"
  | "expired"
  | "error";

export interface ConnectorStatusRow {
  kind: string;
  name: string;
  description?: string;
  hasOAuth: boolean;
  /** OAuth scopes the connector will request when the user clicks Add. */
  oauthScopes?: string[];
  connected: boolean;
  status: string;
  lastSyncAt?: string | Date | null;
}

export interface ConnectorViewModel {
  kind: string;
  name: string;
  description: string;
  hasOAuth: boolean;
  oauthScopes: string[];
  status: NormalizedStatus;
  /** Human-readable status, suitable for a badge label. */
  statusLabel: string;
  lastSyncLabel: string | null;
  /** True when the user can click Add → start OAuth right now. */
  canAdd: boolean;
  /** True when the user can click Disconnect / Reconnect. */
  canManage: boolean;
}

/**
 * Map the raw status string from /api/connectors/status into the
 * card-rendering enum. The framework's connectors table uses "active"
 * for healthy connections; we translate that into "connected" for the
 * UI's vocabulary.
 */
export function normalizeConnectorStatus(
  raw: ConnectorStatusRow,
): NormalizedStatus {
  if (!raw.connected) return "not_connected";
  const s = raw.status.toLowerCase();
  if (s === "active" || s === "connected") return "connected";
  if (s === "expired" || s === "token_expired") return "expired";
  if (s === "error" || s === "failed") return "error";
  // Defensive default: if we can't classify, surface as error so the
  // user investigates rather than assuming health.
  return "error";
}

const STATUS_LABELS: Record<NormalizedStatus, string> = {
  not_connected: "Not connected",
  connected: "Connected",
  expired: "Token expired",
  error: "Error",
};

export function statusLabel(s: NormalizedStatus): string {
  return STATUS_LABELS[s];
}

/**
 * Friendly relative time string for "last sync N minutes ago". Returns
 * null when there's no sync to format. We don't pull in date-fns or
 * dayjs for a single use; this stays in-house and predictable.
 */
export function formatLastSync(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const then = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(then.getTime())) return null;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}

export function toViewModel(
  row: ConnectorStatusRow,
  now: Date = new Date(),
): ConnectorViewModel {
  const status = normalizeConnectorStatus(row);
  return {
    kind: row.kind,
    name: row.name,
    description: row.description ?? "",
    hasOAuth: row.hasOAuth,
    oauthScopes: row.oauthScopes ?? [],
    status,
    statusLabel: statusLabel(status),
    lastSyncLabel:
      status === "connected" ? formatLastSync(row.lastSyncAt, now) : null,
    canAdd: status === "not_connected" && row.hasOAuth,
    canManage: status !== "not_connected",
  };
}

/**
 * Render an OAuth scope URL into a human-readable label. Most providers
 * encode the resource as the URL path (Google: ".../auth/gmail.modify"),
 * which gives us a useful default. Slack's scopes are bare strings
 * ("channels:read") so we hand those back unchanged.
 */
export function humanizeScope(scope: string): string {
  if (!scope) return "";
  // URL-style scope: take the last path segment.
  if (scope.includes("://")) {
    try {
      const u = new URL(scope);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last) return last;
    } catch {
      /* fall through */
    }
  }
  return scope;
}

export interface ConnectorsPageVM {
  /** Cards to render, sorted with connected first then alphabetical. */
  cards: ConnectorViewModel[];
  /** True when no connectors are registered with the framework. */
  isEmpty: boolean;
  /** Counts for chrome / health indicator. */
  counts: {
    total: number;
    connected: number;
    degraded: number;
  };
}

export function buildPageViewModel(
  rows: ConnectorStatusRow[] | null | undefined,
  now: Date = new Date(),
): ConnectorsPageVM {
  const list = rows ?? [];
  const cards = list
    .map((r) => toViewModel(r, now))
    .sort((a, b) => {
      // Connected first; degraded together; not-connected last; tiebreak by name
      const order = (s: NormalizedStatus) =>
        s === "connected" ? 0 : s === "expired" || s === "error" ? 1 : 2;
      const diff = order(a.status) - order(b.status);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });

  return {
    cards,
    isEmpty: list.length === 0,
    counts: {
      total: cards.length,
      connected: cards.filter((c) => c.status === "connected").length,
      degraded: cards.filter(
        (c) => c.status === "expired" || c.status === "error",
      ).length,
    },
  };
}

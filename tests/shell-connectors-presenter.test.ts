// SPDX-License-Identifier: BUSL-1.1
//
// N1 — Connectors page view-model. The React component renders against
// these helpers; the helpers are pure so we cover the matrix of states
// (not_connected / connected / expired / error) without a jsdom harness.

import { describe, it, expect } from "vitest";
import {
  buildPageViewModel,
  formatLastSync,
  humanizeScope,
  normalizeConnectorStatus,
  toViewModel,
  type ConnectorStatusRow,
} from "@boringos/shell/screens/Connectors/connectorsPresenter.js";

const NOW = new Date("2026-05-06T12:00:00Z");

function row(over: Partial<ConnectorStatusRow> = {}): ConnectorStatusRow {
  return {
    kind: "google",
    name: "Google",
    description: "Gmail + Calendar",
    hasOAuth: true,
    oauthScopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    connected: false,
    status: "not_connected",
    lastSyncAt: null,
    ...over,
  };
}

describe("normalizeConnectorStatus", () => {
  it("maps not-connected when connected=false regardless of status", () => {
    expect(normalizeConnectorStatus(row({ connected: false }))).toBe("not_connected");
    expect(
      normalizeConnectorStatus(row({ connected: false, status: "active" })),
    ).toBe("not_connected");
  });

  it("maps active and connected to 'connected'", () => {
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "active" })),
    ).toBe("connected");
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "CONNECTED" })),
    ).toBe("connected");
  });

  it("maps expired token states", () => {
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "expired" })),
    ).toBe("expired");
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "token_expired" })),
    ).toBe("expired");
  });

  it("maps error/failed", () => {
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "error" })),
    ).toBe("error");
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "failed" })),
    ).toBe("error");
  });

  it("defaults unknown statuses to error so the user investigates", () => {
    expect(
      normalizeConnectorStatus(row({ connected: true, status: "weird" })),
    ).toBe("error");
  });
});

describe("formatLastSync", () => {
  it("returns null for null/undefined and invalid", () => {
    expect(formatLastSync(null, NOW)).toBeNull();
    expect(formatLastSync(undefined, NOW)).toBeNull();
    expect(formatLastSync("not-a-date", NOW)).toBeNull();
  });

  it("returns 'just now' under 60s and for future dates", () => {
    expect(formatLastSync(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    expect(formatLastSync(new Date(NOW.getTime() + 60_000), NOW)).toBe("just now");
  });

  it("formats minutes, hours, days", () => {
    expect(formatLastSync(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m ago");
    expect(formatLastSync(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe("3h ago");
    expect(formatLastSync(new Date(NOW.getTime() - 2 * 86400_000), NOW)).toBe("2d ago");
  });

  it("falls back to ISO date past 30 days", () => {
    const old = new Date(NOW.getTime() - 60 * 86400_000);
    expect(formatLastSync(old, NOW)).toBe(old.toISOString().slice(0, 10));
  });
});

describe("toViewModel", () => {
  it("connected card shows last-sync and Disconnect-only affordance", () => {
    const vm = toViewModel(
      row({
        connected: true,
        status: "active",
        lastSyncAt: new Date(NOW.getTime() - 10 * 60_000),
      }),
      NOW,
    );
    expect(vm.status).toBe("connected");
    expect(vm.statusLabel).toBe("Connected");
    expect(vm.lastSyncLabel).toBe("10m ago");
    expect(vm.canAdd).toBe(false);
    expect(vm.canManage).toBe(true);
  });

  it("not-connected card shows Add when hasOAuth", () => {
    const vm = toViewModel(row({ hasOAuth: true }), NOW);
    expect(vm.status).toBe("not_connected");
    expect(vm.canAdd).toBe(true);
    expect(vm.canManage).toBe(false);
    expect(vm.lastSyncLabel).toBeNull();
  });

  it("not-connected without OAuth disables Add", () => {
    const vm = toViewModel(row({ hasOAuth: false }), NOW);
    expect(vm.canAdd).toBe(false);
  });

  it("expired card surfaces Reconnect affordance via canManage", () => {
    const vm = toViewModel(
      row({ connected: true, status: "expired" }),
      NOW,
    );
    expect(vm.status).toBe("expired");
    expect(vm.canManage).toBe(true);
    expect(vm.lastSyncLabel).toBeNull();
  });
});

describe("humanizeScope", () => {
  it("extracts the last path segment from a URL scope (Google style)", () => {
    expect(
      humanizeScope("https://www.googleapis.com/auth/gmail.modify"),
    ).toBe("gmail.modify");
    expect(
      humanizeScope("https://www.googleapis.com/auth/calendar.events"),
    ).toBe("calendar.events");
  });

  it("returns Slack-style bare scopes unchanged", () => {
    expect(humanizeScope("channels:read")).toBe("channels:read");
    expect(humanizeScope("chat:write")).toBe("chat:write");
  });

  it("handles empty + garbage", () => {
    expect(humanizeScope("")).toBe("");
    expect(humanizeScope("not-a-url")).toBe("not-a-url");
  });
});

describe("buildPageViewModel", () => {
  it("returns empty when registry is empty", () => {
    const vm = buildPageViewModel([], NOW);
    expect(vm.isEmpty).toBe(true);
    expect(vm.cards).toEqual([]);
    expect(vm.counts).toEqual({ total: 0, connected: 0, degraded: 0 });
  });

  it("returns empty for null/undefined input", () => {
    expect(buildPageViewModel(null, NOW).isEmpty).toBe(true);
    expect(buildPageViewModel(undefined, NOW).isEmpty).toBe(true);
  });

  it("sorts connected before degraded before not-connected, then alphabetically", () => {
    const vm = buildPageViewModel(
      [
        row({ kind: "slack", name: "Slack" }),
        row({
          kind: "google",
          name: "Google",
          connected: true,
          status: "active",
        }),
        row({
          kind: "stripe",
          name: "Stripe",
          connected: true,
          status: "expired",
        }),
        row({ kind: "github", name: "GitHub" }),
      ],
      NOW,
    );
    expect(vm.cards.map((c) => c.kind)).toEqual([
      "google", // connected first
      "stripe", // degraded second
      "github", // not-connected, alpha
      "slack",
    ]);
  });

  it("counts connected and degraded correctly in mixed state", () => {
    const vm = buildPageViewModel(
      [
        row({ kind: "a", name: "A", connected: true, status: "active" }),
        row({ kind: "b", name: "B", connected: true, status: "active" }),
        row({ kind: "c", name: "C", connected: true, status: "expired" }),
        row({ kind: "d", name: "D", connected: true, status: "error" }),
        row({ kind: "e", name: "E" }),
      ],
      NOW,
    );
    expect(vm.counts).toEqual({ total: 5, connected: 2, degraded: 2 });
  });
});

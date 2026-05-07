// SPDX-License-Identifier: BUSL-1.1
//
// Snooze preset arithmetic + relative-time formatter. Both are pure
// helpers used heavily on every list render of the snoozed tab.

import { describe, it, expect } from "vitest";
import {
  SNOOZE_PRESETS,
  formatWakeIn,
} from "@boringos/shell/screens/Inbox/snooze.js";

const NOW = new Date("2026-05-07T10:00:00Z");

describe("SNOOZE_PRESETS", () => {
  it("ships four presets", () => {
    expect(SNOOZE_PRESETS.map((p) => p.id)).toEqual([
      "1h",
      "4h",
      "tomorrow",
      "next-week",
    ]);
  });

  it("1h adds exactly one hour", () => {
    const preset = SNOOZE_PRESETS.find((p) => p.id === "1h")!;
    const got = preset.resolve(NOW);
    expect(got.getTime() - NOW.getTime()).toBe(60 * 60_000);
  });

  it("4h adds exactly four hours", () => {
    const preset = SNOOZE_PRESETS.find((p) => p.id === "4h")!;
    expect(preset.resolve(NOW).getTime() - NOW.getTime()).toBe(4 * 60 * 60_000);
  });

  it("tomorrow lands on next day at 9am local", () => {
    const preset = SNOOZE_PRESETS.find((p) => p.id === "tomorrow")!;
    const got = preset.resolve(NOW);
    expect(got.getHours()).toBe(9);
    expect(got.getMinutes()).toBe(0);
    // Next calendar date.
    const next = new Date(NOW);
    next.setDate(next.getDate() + 1);
    expect(got.getDate()).toBe(next.getDate());
  });

  it("next-week lands on a Monday", () => {
    const preset = SNOOZE_PRESETS.find((p) => p.id === "next-week")!;
    const got = preset.resolve(NOW);
    expect(got.getDay()).toBe(1); // Monday
    expect(got.getHours()).toBe(9);
  });
});

describe("formatWakeIn", () => {
  it("returns 'now' for past or current times", () => {
    expect(formatWakeIn(new Date(NOW.getTime() - 1000), NOW)).toBe("now");
    expect(formatWakeIn(NOW, NOW)).toBe("now");
  });

  it("formats minutes for sub-hour", () => {
    expect(formatWakeIn(new Date(NOW.getTime() + 30 * 60_000), NOW)).toBe("in 30m");
  });

  it("formats hours for sub-day", () => {
    expect(formatWakeIn(new Date(NOW.getTime() + 5 * 3600_000), NOW)).toBe("in 5h");
  });

  it("formats days for sub-week", () => {
    expect(formatWakeIn(new Date(NOW.getTime() + 3 * 86400_000), NOW)).toBe("in 3d");
  });

  it("falls back to date for >=7d", () => {
    const future = new Date("2026-06-15T10:00:00Z");
    expect(formatWakeIn(future, NOW)).toMatch(/Jun \d+/);
  });

  it("returns empty string for invalid input", () => {
    expect(formatWakeIn("not-a-date", NOW)).toBe("");
  });
});

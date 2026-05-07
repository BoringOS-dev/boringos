// SPDX-License-Identifier: BUSL-1.1
//
// Pure-helper coverage for Inbox/presenter.ts. The list-row formatting
// is on the user's hot path — every row renders through these on every
// status switch — so we lock the behavior down here.

import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatAbsoluteTime,
  parseSenderName,
  snippetFrom,
} from "@boringos/shell/screens/Inbox/presenter.js";

const NOW = new Date("2026-05-07T12:00:00Z");

describe("formatRelativeTime", () => {
  it("returns 'now' when under 60s", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe("now");
  });

  it("formats minutes for sub-hour gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m");
    expect(formatRelativeTime(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe("59m");
  });

  it("formats hours for sub-day gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe("3h");
    expect(formatRelativeTime(new Date(NOW.getTime() - 23 * 3600_000), NOW)).toBe("23h");
  });

  it("formats days for sub-week gaps", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 2 * 86400_000), NOW)).toBe("2d");
    expect(formatRelativeTime(new Date(NOW.getTime() - 6 * 86400_000), NOW)).toBe("6d");
  });

  it("uses month + day for >=7d in same year", () => {
    const d = new Date("2026-04-15T10:00:00Z");
    expect(formatRelativeTime(d, NOW)).toBe("Apr 15");
  });

  it("includes year for different-year timestamps", () => {
    const d = new Date("2025-12-25T10:00:00Z");
    expect(formatRelativeTime(d, NOW)).toBe("Dec 25 2025");
  });

  it("returns empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders something non-empty for valid dates", () => {
    expect(formatAbsoluteTime(new Date("2026-05-07T10:00:00Z"), NOW).length).toBeGreaterThan(0);
  });

  it("returns empty string for invalid input", () => {
    expect(formatAbsoluteTime("not-a-date", NOW)).toBe("");
  });
});

describe("parseSenderName", () => {
  it("extracts quoted display name", () => {
    expect(parseSenderName('"Jordan Cohen" <jordan@cohenlee.example>')).toBe("Jordan Cohen");
  });

  it("extracts bare display name", () => {
    expect(parseSenderName("Jordan Cohen <jordan@cohenlee.example>")).toBe("Jordan Cohen");
  });

  it("returns the email when there's no display name", () => {
    expect(parseSenderName("jordan@cohenlee.example")).toBe("jordan@cohenlee.example");
  });

  it("trims whitespace inside the quoted variant", () => {
    expect(parseSenderName('"  Jordan Cohen  " <j@x>')).toBe("Jordan Cohen");
  });

  it("falls back when null/undefined", () => {
    expect(parseSenderName(null)).toBe("(unknown sender)");
    expect(parseSenderName(undefined)).toBe("(unknown sender)");
    expect(parseSenderName("")).toBe("(unknown sender)");
  });
});

describe("snippetFrom", () => {
  it("strips HTML tags", () => {
    expect(snippetFrom("<p>Hello <b>World</b></p>", 80)).toBe("Hello World");
  });

  it("collapses whitespace", () => {
    expect(snippetFrom("hello\n\n\n  world", 80)).toBe("hello world");
  });

  it("drops quoted lines (gmail >)", () => {
    expect(snippetFrom("Reply text\n> previous email\n> another quoted line\nMore reply", 80))
      .toBe("Reply text More reply");
  });

  it("decodes basic html entities", () => {
    expect(snippetFrom("Hello&nbsp;World &amp; goodbye", 80)).toBe("Hello World & goodbye");
  });

  it("truncates with ellipsis past maxChars", () => {
    const long = "a".repeat(200);
    const out = snippetFrom(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("doesn't truncate when shorter than maxChars", () => {
    expect(snippetFrom("short text", 80)).toBe("short text");
  });
});

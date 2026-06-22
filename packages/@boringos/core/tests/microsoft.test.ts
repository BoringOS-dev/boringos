// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from "vitest";
import { createMicrosoftModule } from "../src/modules/microsoft.js";

type ToolResult = { ok: boolean; result?: unknown; error?: { code: string; message: string } };

function build(getConnectorToken: unknown) {
  // Only getConnectorToken is exercised by these handlers; cast the rest.
  const mod = createMicrosoftModule({ getConnectorToken } as never);
  const tool = (name: string) => {
    const t = mod.tools?.find((x) => x.name === name);
    if (!t) throw new Error(`tool not found: ${name}`);
    return t as { handler: (input: unknown) => Promise<ToolResult> };
  };
  return { mod, tool };
}

const connected = () => ({ getToken: async () => "tok" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMicrosoftModule", () => {
  it("registers the expected tool surface", () => {
    const { mod } = build(() => null);
    const names = (mod.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "calendar.create_event",
        "calendar.find_free_slots",
        "calendar.list_events",
        "calendar.update_event",
        "contacts.list_contacts",
        "contacts.search_people",
        "files.get_file",
        "files.list_files",
        "mail.list_emails",
        "mail.read_email",
        "mail.reply_email",
        "mail.search_emails",
        "mail.send_email",
      ].sort(),
    );
    expect(mod.id).toBe("microsoft");
    expect(mod.kind).toBe("connector");
    expect(mod.connectors?.microsoft?.services.map((s) => s.id).sort()).toEqual([
      "calendar",
      "contacts",
      "files",
      "mail",
    ]);
  });

  it("returns not_found when the account is not connected", async () => {
    const { tool } = build(async () => null);
    const res = await tool("mail.list_emails").handler({});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("not_found");
  });

  it("mail.list_emails returns messages on the happy path", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: [{ id: "m1", subject: "Hi" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { tool } = build(async () => connected());
    const res = await tool("mail.list_emails").handler({ query: "invoice" });
    expect(res.ok).toBe(true);
    expect((res.result as { messages: unknown[] }).messages).toHaveLength(1);
    // token was injected as a Bearer header
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("mail.send_email reports sent", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { tool } = build(async () => connected());
    const res = await tool("mail.send_email").handler({ to: "a@b.com", subject: "Hi", body: "Yo" });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ sent: true });
  });

  it("calendar.create_event maps friendly inputs to Graph shape", async () => {
    let sentBody: any;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: "e1", subject: "Sync" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tool } = build(async () => connected());
    const res = await tool("calendar.create_event").handler({
      summary: "Sync",
      startTime: "2026-06-01T10:00:00",
      endTime: "2026-06-01T10:30:00",
      attendees: ["x@y.com"],
      timeZone: "UTC",
    });
    expect(res.ok).toBe(true);
    expect(sentBody.subject).toBe("Sync");
    expect(sentBody.start).toEqual({ dateTime: "2026-06-01T10:00:00", timeZone: "UTC" });
    expect(sentBody.attendees).toEqual([{ emailAddress: { address: "x@y.com" } }]);
  });

  it("surfaces upstream failures as upstream_unavailable", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { tool } = build(async () => connected());
    const res = await tool("mail.list_emails").handler({});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("upstream_unavailable");
  });
});

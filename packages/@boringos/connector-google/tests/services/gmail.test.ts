import { describe, it, expect, vi } from "vitest";
import { GmailClient } from "../../src/services/gmail/client.js";

describe("GmailClient (v2 typed)", () => {
  it("lists messages with query", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "a", threadId: "t1" }] }), { status: 200 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listMessages({ query: "is:unread" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
    expect(result[0]?.threadId).toBe("t1");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("listAttachments walks nested parts and skips inline/non-file parts", () => {
    const client = new GmailClient("token");
    const message = {
      id: "m1",
      threadId: "t1",
      labelIds: [],
      snippet: "",
      internalDate: "",
      payload: {
        headers: [],
        parts: [
          { mimeType: "text/plain", body: { size: 10 } }, // body text, no filename → skipped
          {
            mimeType: "multipart/mixed",
            parts: [
              { mimeType: "application/pdf", filename: "deck.pdf", body: { attachmentId: "att-1", size: 2048 } },
              { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-2", size: 512 } },
              { mimeType: "text/html", body: { size: 99 } }, // no filename → skipped
            ],
          },
        ],
      },
    };
    const atts = client.listAttachments(message);
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({ attachmentId: "att-1", filename: "deck.pdf", mimeType: "application/pdf", size: 2048 });
    expect(atts[1]?.filename).toBe("logo.png");
  });

  it("getAttachment decodes base64url data to a Buffer", async () => {
    const original = Buffer.from("%PDF-1.7 hello", "utf8");
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/messages/m1/attachments/att-1");
      return new Response(JSON.stringify({ data: original.toString("base64url"), size: original.length }), { status: 200 });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const bytes = await client.getAttachment("m1", "att-1");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf8")).toBe("%PDF-1.7 hello");
  });

  it("returns empty array when no messages", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listMessages();
    expect(result).toHaveLength(0);
  });

  it("supports token-provider function", async () => {
    let calls = 0;
    const getToken = async () => `t${++calls}`;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization");
      expect(auth).toBe(`Bearer t${calls}`);
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    const client = new GmailClient(getToken, fetchMock as unknown as typeof fetch);
    await client.listMessages();
    expect(calls).toBe(1);
  });

  it("throws on non-ok listMessages response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("Unauthorized", { status: 403 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.listMessages()).rejects.toThrow("Gmail listMessages failed: 403");
  });

  it("includes labelIds query param when provided", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    await client.listMessages({ labelIds: ["INBOX", "UNREAD"] });
    expect(capturedUrl).toContain("labelIds=INBOX");
    expect(capturedUrl).toContain("labelIds=UNREAD");
  });

  it("getMessage fetches and returns typed message", async () => {
    const mockMsg = {
      id: "msg1",
      threadId: "t1",
      labelIds: ["INBOX"],
      snippet: "Hello",
      internalDate: "1700000000000",
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mockMsg), { status: 200 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.getMessage("msg1");
    expect(result.id).toBe("msg1");
    expect(result.snippet).toBe("Hello");
  });

  it("throws on non-ok getMessage response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("Not Found", { status: 404 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    await expect(client.getMessage("missing")).rejects.toThrow("Gmail getMessage failed: 404");
  });

  it("searchMessages delegates to listMessages with query", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ messages: [{ id: "x", threadId: "t2" }] }), {
        status: 200,
      });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.searchMessages("from:alice");
    expect(capturedUrl).toContain("q=from%3Aalice");
    expect(result).toHaveLength(1);
  });

  it("modifyLabels sends correct body", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response("", { status: 200 });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    await client.modifyLabels("msg1", { addLabelIds: ["STARRED"], removeLabelIds: ["INBOX"] });
    expect(capturedBody).toEqual({ addLabelIds: ["STARRED"], removeLabelIds: ["INBOX"] });
  });

  it("archiveMessage removes INBOX label", async () => {
    let capturedBody: unknown;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response("", { status: 200 });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    await client.archiveMessage("msg1");
    expect(capturedBody).toEqual({ removeLabelIds: ["INBOX"] });
  });

  it("ensureLabel returns existing label without creating", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ labels: [{ id: "L1", name: "MyLabel" }] }),
        { status: 200 },
      ),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.ensureLabel("MyLabel");
    expect(result.labelId).toBe("L1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ensureLabel creates label when not found", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ labels: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "L2" }), { status: 200 });
    });
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.ensureLabel("NewLabel");
    expect(result.labelId).toBe("L2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listHistory returns events array", async () => {
    const events = [{ id: "h1", messagesAdded: [] }];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ history: events }), { status: 200 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listHistory("1234");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("h1");
  });

  it("listHistory returns empty array when no history", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const client = new GmailClient("token", fetchMock as unknown as typeof fetch);
    const result = await client.listHistory("9999");
    expect(result).toEqual([]);
  });
});

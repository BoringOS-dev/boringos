import type { ActionResult } from "@boringos/connector";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Decode a base64url-encoded Gmail body part to UTF-8 text. */
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

type GmailPayload = {
  body?: { data?: string };
  mimeType?: string;
  parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> }>;
};

/** Extract both plain-text and HTML bodies from a Gmail message payload. */
function extractBodies(
  payload?: GmailPayload,
): { plain: string | null; html: string | null } {
  if (!payload) return { plain: null, html: null };

  // Single-part message — body is directly on the payload
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      return { plain: null, html: decoded };
    }
    return { plain: decoded, html: null };
  }

  if (!payload.parts) return { plain: null, html: null };

  // Multipart — collect both text/plain and text/html
  let plain: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    }
    // Nested multipart (e.g. multipart/alternative inside multipart/mixed)
    if (part.parts) {
      for (const sub of part.parts) {
        if (sub.mimeType === "text/plain" && sub.body?.data && !plain) {
          plain = decodeBase64Url(sub.body.data);
        } else if (sub.mimeType === "text/html" && sub.body?.data && !html) {
          html = decodeBase64Url(sub.body.data);
        }
      }
    }
  }

  return { plain, html };
}

/** Extract the best plain-text body from a Gmail message payload. Backward-compatible wrapper. */
function extractBody(
  payload?: GmailPayload,
): string | null {
  const { plain, html } = extractBodies(payload);
  return plain ?? html ?? null;
}

export class GmailClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "list_emails": return this.listEmails(inputs.query as string | undefined, inputs.maxResults as number | undefined);
      case "read_email": return this.readEmail(inputs.messageId as string);
      case "send_email": return this.sendEmail(inputs.to as string, inputs.subject as string, inputs.body as string);
      case "search_emails": return this.listEmails(inputs.query as string, inputs.maxResults as number | undefined);
      case "get_thread": return this.getThread(inputs.threadId as string);
      case "archive_email": return this.archiveEmail(inputs.messageId as string);
      case "reply_email": return this.replyEmail(
        inputs.messageId as string,
        inputs.threadId as string,
        inputs.to as string,
        inputs.subject as string,
        inputs.body as string,
      );
      default: return { success: false, error: `Unknown Gmail action: ${action}` };
    }
  }

  private async listEmails(query?: string, maxResults?: number): Promise<ActionResult> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("maxResults", String(maxResults ?? 10));

    const res = await this.api(`${GMAIL_API}/messages?${params}`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    const rawMessages = (data.messages ?? []) as Array<{ id: string; threadId: string }>;

    // Enrich each message with full content (subject, from, body, date)
    const enriched = await Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const fullRes = await this.api(
            `${GMAIL_API}/messages/${msg.id}?format=full`,
          );
          if (!fullRes.ok) return { id: msg.id, threadId: msg.threadId, subject: null, from: null, body: null, bodyHtml: null, snippet: null, date: null };

          const fullData = await fullRes.json() as {
            id: string;
            threadId: string;
            snippet?: string;
            payload?: GmailPayload & {
              headers?: Array<{ name: string; value: string }>;
            };
          };

          const headers = fullData.payload?.headers ?? [];
          const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

          // Extract both plain and HTML body from payload
          const { plain, html } = extractBodies(fullData.payload);

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: getHeader("Subject"),
            from: getHeader("From"),
            date: getHeader("Date"),
            body: plain ?? html,
            bodyHtml: html,
            snippet: fullData.snippet ?? null,
          };
        } catch {
          return { id: msg.id, threadId: msg.threadId, subject: null, from: null, body: null, bodyHtml: null, snippet: null, date: null };
        }
      }),
    );

    return { success: true, data: { messages: enriched, resultSizeEstimate: data.resultSizeEstimate } };
  }

  private async readEmail(messageId: string): Promise<ActionResult> {
    const res = await this.api(`${GMAIL_API}/messages/${messageId}?format=full`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: data as Record<string, unknown> };
  }

  private async getThread(threadId: string): Promise<ActionResult> {
    const res = await this.api(`${GMAIL_API}/threads/${threadId}?format=full`);
    if (!res.ok) return { success: false, error: `Gmail API error: ${res.status}` };

    const data = await res.json() as {
      id: string;
      messages?: Array<{
        id: string;
        threadId: string;
        snippet?: string;
        payload?: GmailPayload & {
          headers?: Array<{ name: string; value: string }>;
        };
      }>;
    };

    const messages = (data.messages ?? []).map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
      const { plain, html } = extractBodies(msg.payload);

      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        bodyPlain: plain,
        bodyHtml: html,
        snippet: msg.snippet ?? null,
      };
    });

    return { success: true, data: { threadId, messages } };
  }

  private async archiveEmail(messageId: string): Promise<ActionResult> {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });

    if (!res.ok) return { success: false, error: `Gmail archive failed: ${res.status}` };
    return { success: true, data: { id: messageId } };
  }

  private async replyEmail(
    messageId: string,
    threadId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<ActionResult> {
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${replySubject}\r\nIn-Reply-To: ${messageId}\r\nReferences: ${messageId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ raw, threadId }),
    });

    if (!res.ok) return { success: false, error: `Gmail reply failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  private async sendEmail(to: string, subject: string, body: string): Promise<ActionResult> {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) return { success: false, error: `Gmail send failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  private api(url: string): Promise<Response> {
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}

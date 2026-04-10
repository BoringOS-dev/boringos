import type { ActionResult } from "@boringos/connector";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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

    // Enrich each message with metadata (subject, from, snippet, date)
    const enriched = await Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const metaRes = await this.api(
            `${GMAIL_API}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          );
          if (!metaRes.ok) return { id: msg.id, threadId: msg.threadId, subject: null, from: null, snippet: null, date: null };

          const metaData = await metaRes.json() as {
            id: string;
            threadId: string;
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };

          const headers = metaData.payload?.headers ?? [];
          const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: getHeader("Subject"),
            from: getHeader("From"),
            date: getHeader("Date"),
            snippet: metaData.snippet ?? null,
          };
        } catch {
          return { id: msg.id, threadId: msg.threadId, subject: null, from: null, snippet: null, date: null };
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

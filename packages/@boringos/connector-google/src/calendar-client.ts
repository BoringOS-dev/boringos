import type { ActionResult } from "@boringos/connector";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class CalendarClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case "list_events": return this.listEvents(inputs.timeMin as string | undefined, inputs.timeMax as string | undefined, inputs.maxResults as number | undefined);
      case "create_event": return this.createEvent(inputs as Record<string, unknown>);
      case "update_event": return this.updateEvent(inputs.eventId as string, inputs as Record<string, unknown>);
      case "find_free_slots": return this.findFreeSlots(inputs.timeMin as string, inputs.timeMax as string, inputs.durationMinutes as number);
      default: return { success: false, error: `Unknown Calendar action: ${action}` };
    }
  }

  private async listEvents(timeMin?: string, timeMax?: string, maxResults?: number): Promise<ActionResult> {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(maxResults ?? 10),
    });
    if (timeMin) params.set("timeMin", timeMin);
    if (timeMax) params.set("timeMax", timeMax);

    const res = await this.api(`${CALENDAR_API}/calendars/primary/events?${params}`);
    if (!res.ok) return { success: false, error: `Calendar API error: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { events: data.items ?? [] } };
  }

  private async createEvent(inputs: Record<string, unknown>): Promise<ActionResult> {
    const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        summary: inputs.summary,
        description: inputs.description,
        start: { dateTime: inputs.startTime, timeZone: inputs.timeZone ?? "UTC" },
        end: { dateTime: inputs.endTime, timeZone: inputs.timeZone ?? "UTC" },
        attendees: inputs.attendees ? (inputs.attendees as string[]).map((e) => ({ email: e })) : undefined,
      }),
    });

    if (!res.ok) return { success: false, error: `Calendar create failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id, htmlLink: data.htmlLink } };
  }

  private async updateEvent(eventId: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    const body: Record<string, unknown> = {};
    if (inputs.summary) body.summary = inputs.summary;
    if (inputs.description) body.description = inputs.description;
    if (inputs.startTime) body.start = { dateTime: inputs.startTime, timeZone: inputs.timeZone ?? "UTC" };
    if (inputs.endTime) body.end = { dateTime: inputs.endTime, timeZone: inputs.timeZone ?? "UTC" };

    const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { success: false, error: `Calendar update failed: ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return { success: true, data: { id: data.id } };
  }

  private async findFreeSlots(timeMin: string, timeMax: string, durationMinutes: number): Promise<ActionResult> {
    // Use freebusy API
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: "primary" }],
      }),
    });

    if (!res.ok) return { success: false, error: `Calendar freebusy failed: ${res.status}` };

    const data = await res.json() as Record<string, unknown>;
    const calendars = data.calendars as Record<string, { busy: Array<{ start: string; end: string }> }>;
    const busy = calendars?.primary?.busy ?? [];

    // Calculate free slots
    const slots: Array<{ start: string; end: string }> = [];
    let cursor = new Date(timeMin);
    const end = new Date(timeMax);
    const durationMs = durationMinutes * 60 * 1000;

    for (const block of busy) {
      const blockStart = new Date(block.start);
      if (blockStart.getTime() - cursor.getTime() >= durationMs) {
        slots.push({ start: cursor.toISOString(), end: blockStart.toISOString() });
      }
      cursor = new Date(block.end);
    }
    if (end.getTime() - cursor.getTime() >= durationMs) {
      slots.push({ start: cursor.toISOString(), end: end.toISOString() });
    }

    return { success: true, data: { slots } };
  }

  private api(url: string): Promise<Response> {
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
}

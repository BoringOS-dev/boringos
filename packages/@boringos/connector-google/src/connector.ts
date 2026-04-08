import type {
  ConnectorDefinition,
  ConnectorCredentials,
  ConnectorClient,
  ActionResult,
} from "@boringos/connector";
import { GmailClient } from "./gmail-client.js";
import { CalendarClient } from "./calendar-client.js";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

class GoogleWorkspaceClient implements ConnectorClient {
  private gmail: GmailClient;
  private calendar: CalendarClient;

  constructor(credentials: ConnectorCredentials) {
    this.gmail = new GmailClient(credentials.accessToken);
    this.calendar = new CalendarClient(credentials.accessToken);
  }

  async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
    // Route to the right sub-client
    const gmailActions = ["list_emails", "read_email", "send_email", "search_emails"];
    const calendarActions = ["list_events", "create_event", "update_event", "find_free_slots"];

    if (gmailActions.includes(action)) return this.gmail.executeAction(action, inputs);
    if (calendarActions.includes(action)) return this.calendar.executeAction(action, inputs);
    return { success: false, error: `Unknown Google Workspace action: ${action}` };
  }
}

export function google(config: GoogleConfig): ConnectorDefinition {
  return {
    kind: "google",
    name: "Google Workspace",
    description: "Gmail and Google Calendar integration.",

    oauth: {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      extraParams: { access_type: "offline", prompt: "consent" },
    },

    events: [
      { type: "email_received", description: "A new email was received in Gmail" },
      { type: "calendar_event_created", description: "A new calendar event was created" },
      { type: "calendar_event_updated", description: "A calendar event was modified" },
    ],

    actions: [
      // Gmail
      {
        name: "list_emails",
        description: "List recent emails, optionally filtered by query",
        inputs: {
          query: { type: "string", description: "Gmail search query (e.g., 'from:boss is:unread')" },
          maxResults: { type: "number", description: "Max emails to return (default: 10)" },
        },
      },
      {
        name: "read_email",
        description: "Read the full content of an email by message ID",
        inputs: {
          messageId: { type: "string", description: "Gmail message ID", required: true },
        },
      },
      {
        name: "send_email",
        description: "Send an email",
        inputs: {
          to: { type: "string", description: "Recipient email address", required: true },
          subject: { type: "string", description: "Email subject", required: true },
          body: { type: "string", description: "Email body (plain text)", required: true },
        },
      },
      {
        name: "search_emails",
        description: "Search emails with a Gmail query",
        inputs: {
          query: { type: "string", description: "Gmail search query", required: true },
          maxResults: { type: "number", description: "Max results (default: 10)" },
        },
      },
      // Calendar
      {
        name: "list_events",
        description: "List upcoming calendar events",
        inputs: {
          timeMin: { type: "string", description: "Start time (ISO 8601)" },
          timeMax: { type: "string", description: "End time (ISO 8601)" },
          maxResults: { type: "number", description: "Max events (default: 10)" },
        },
      },
      {
        name: "create_event",
        description: "Create a calendar event",
        inputs: {
          summary: { type: "string", description: "Event title", required: true },
          startTime: { type: "string", description: "Start time (ISO 8601)", required: true },
          endTime: { type: "string", description: "End time (ISO 8601)", required: true },
          description: { type: "string", description: "Event description" },
          attendees: { type: "array", description: "List of attendee email addresses" },
          timeZone: { type: "string", description: "Timezone (default: UTC)" },
        },
      },
      {
        name: "update_event",
        description: "Update an existing calendar event",
        inputs: {
          eventId: { type: "string", description: "Calendar event ID", required: true },
          summary: { type: "string", description: "New title" },
          startTime: { type: "string", description: "New start time (ISO 8601)" },
          endTime: { type: "string", description: "New end time (ISO 8601)" },
          description: { type: "string", description: "New description" },
        },
      },
      {
        name: "find_free_slots",
        description: "Find available time slots in the calendar",
        inputs: {
          timeMin: { type: "string", description: "Search window start (ISO 8601)", required: true },
          timeMax: { type: "string", description: "Search window end (ISO 8601)", required: true },
          durationMinutes: { type: "number", description: "Required slot duration in minutes", required: true },
        },
      },
    ],

    createClient(credentials: ConnectorCredentials): ConnectorClient {
      return new GoogleWorkspaceClient(credentials);
    },

    skillMarkdown() {
      return GOOGLE_SKILL;
    },
  };
}

const GOOGLE_SKILL = `# Google Workspace Connector

You can interact with Gmail and Google Calendar.

## Gmail Actions

### list_emails / search_emails
List or search emails. Use Gmail query syntax:
- \`from:boss\` — emails from a specific sender
- \`is:unread\` — unread emails
- \`subject:invoice\` — emails with "invoice" in the subject
- \`after:2026/01/01\` — emails after a date

### read_email
Read the full content of an email by its message ID. Use list_emails first to get IDs.

### send_email
Send a plain-text email. Provide **to**, **subject**, and **body**.

## Calendar Actions

### list_events
List upcoming events. Optionally filter by time range.

### create_event
Create a new event. Requires **summary**, **startTime**, and **endTime** (ISO 8601 format).
Example: \`2026-04-10T14:00:00-07:00\`

### update_event
Modify an existing event by its event ID. Only include fields you want to change.

### find_free_slots
Find available time slots. Specify the search window and required duration in minutes.

## Guidelines

- Always check the calendar before scheduling to avoid conflicts
- Use \`find_free_slots\` before \`create_event\`
- When reading emails, summarize rather than quoting the full content
- Include timezone information with calendar events
`;

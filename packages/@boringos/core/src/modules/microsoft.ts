// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in Microsoft 365 module. Thin wrapper that exposes
// `mail.*`, `calendar.*`, `contacts.*` and `files.*` tools using the
// @boringos/connector-microsoft SDK. The Microsoft counterpart to the
// built-in Google module (modules/google.ts) — same handler shape, same
// result conventions, backed by Microsoft Graph.
//
// Third-party modules can ship their own purpose-specific tools using the
// same SDK without conflicting with these defaults.

import type { ModuleFactory } from "@boringos/module-sdk";
import { z } from "@boringos/module-sdk";
import {
  MailClient,
  CalendarClient,
  ContactsClient,
  FilesClient,
  mailService,
  calendarService,
  contactsService,
  filesService,
} from "@boringos/connector-microsoft";

const MODULE_ID = "microsoft";

const notConnected = () => ({
  ok: false as const,
  error: { code: "not_found" as const, message: "Microsoft account not connected", retryable: false },
});

const upstreamFail = (err: unknown) => ({
  ok: false as const,
  error: {
    code: "upstream_unavailable" as const,
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  },
});

export const createMicrosoftModule: ModuleFactory = (deps) => ({
  id: MODULE_ID,
  name: "Microsoft 365",
  version: "1.0.0",
  description: "Default Outlook mail, calendar, contacts and OneDrive tools, wrapping @boringos/connector-microsoft",
  kind: "connector",
  connectors: {
    microsoft: {
      services: [mailService, calendarService, contactsService, filesService],
    },
  },
  tools: [
    {
      name: "mail.list_emails",
      description: "List recent Outlook messages, optionally filtered by a search query",
      inputs: z.object({
        query: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input: { query?: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const mail = new MailClient(conn.getToken);
          const messages = await mail.listMessages({ query: input.query, top: input.maxResults });
          return { ok: true as const, result: { messages } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "mail.read_email",
      description: "Read full content of an email by message ID",
      inputs: z.object({ messageId: z.string() }),
      async handler(input: { messageId: string }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const mail = new MailClient(conn.getToken);
          const message = await mail.getMessage(input.messageId);
          return { ok: true as const, result: message };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "mail.send_email",
      description: "Send an email through the connected Outlook account",
      inputs: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
        cc: z.string().optional(),
        bodyType: z.enum(["text", "html"]).optional(),
      }),
      async handler(input: { to: string; subject: string; body: string; cc?: string; bodyType?: "text" | "html" }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const mail = new MailClient(conn.getToken);
          await mail.sendEmail(input);
          return { ok: true as const, result: { sent: true } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "mail.reply_email",
      description: "Reply to an existing Outlook message",
      inputs: z.object({
        messageId: z.string(),
        body: z.string(),
        replyAll: z.boolean().optional(),
      }),
      async handler(input: { messageId: string; body: string; replyAll?: boolean }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const mail = new MailClient(conn.getToken);
          await mail.replyToEmail(input);
          return { ok: true as const, result: { sent: true } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "mail.search_emails",
      description: "Search emails with an explicit query string",
      inputs: z.object({ query: z.string(), maxResults: z.number().optional() }),
      async handler(input: { query: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const mail = new MailClient(conn.getToken);
          const messages = await mail.searchMessages(input.query, { top: input.maxResults });
          return { ok: true as const, result: { messages } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.list_events",
      description: "List Outlook calendar events in an optional time window",
      inputs: z.object({
        timeMin: z.string().optional(),
        timeMax: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input: { timeMin?: string; timeMax?: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const events = await cal.listEvents(input);
          return { ok: true as const, result: { events } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.create_event",
      description: "Create an Outlook calendar event",
      inputs: z.object({
        summary: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        timeZone: z.string().optional(),
      }),
      async handler(input: {
        summary: string;
        startTime: string;
        endTime: string;
        description?: string;
        location?: string;
        attendees?: string[];
        timeZone?: string;
      }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const tz = input.timeZone ?? "UTC";
          const event = await cal.createEvent({
            subject: input.summary,
            ...(input.description
              ? { body: { contentType: "text" as const, content: input.description } }
              : {}),
            ...(input.location ? { location: { displayName: input.location } } : {}),
            start: { dateTime: input.startTime, timeZone: tz },
            end: { dateTime: input.endTime, timeZone: tz },
            ...(input.attendees
              ? { attendees: input.attendees.map((address) => ({ emailAddress: { address } })) }
              : {}),
          });
          return { ok: true as const, result: event };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.update_event",
      description: "Update an existing Outlook calendar event",
      inputs: z.object({
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
      async handler(input: {
        eventId: string;
        summary?: string;
        description?: string;
        location?: string;
        startTime?: string;
        endTime?: string;
      }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const patch: Record<string, unknown> = {};
          if (input.summary !== undefined) patch.subject = input.summary;
          if (input.description !== undefined) patch.body = { contentType: "text", content: input.description };
          if (input.location !== undefined) patch.location = { displayName: input.location };
          if (input.startTime) patch.start = { dateTime: input.startTime, timeZone: "UTC" };
          if (input.endTime) patch.end = { dateTime: input.endTime, timeZone: "UTC" };
          const event = await cal.updateEvent(input.eventId, patch);
          return { ok: true as const, result: event };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "calendar.find_free_slots",
      description: "Find open Outlook calendar slots in a window",
      inputs: z.object({
        timeMin: z.string(),
        timeMax: z.string(),
        durationMinutes: z.number(),
      }),
      async handler(input: { timeMin: string; timeMax: string; durationMinutes: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const cal = new CalendarClient(conn.getToken);
          const slots = await cal.findFreeSlots(input);
          return { ok: true as const, result: { slots } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "contacts.list_contacts",
      description: "List saved Outlook contacts",
      inputs: z.object({ maxResults: z.number().optional() }),
      async handler(input: { maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const contacts = new ContactsClient(conn.getToken);
          const result = await contacts.listContacts({ top: input.maxResults });
          return { ok: true as const, result: { contacts: result } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "contacts.search_people",
      description: "Search relevant people across the mailbox (resolve a name to an email)",
      inputs: z.object({ query: z.string(), maxResults: z.number().optional() }),
      async handler(input: { query: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const contacts = new ContactsClient(conn.getToken);
          const people = await contacts.searchPeople(input.query, { top: input.maxResults });
          return { ok: true as const, result: { people } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "files.list_files",
      description: "List or search OneDrive files (root children by default)",
      inputs: z.object({
        query: z.string().optional(),
        folderId: z.string().optional(),
        maxResults: z.number().optional(),
      }),
      async handler(input: { query?: string; folderId?: string; maxResults?: number }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const files = new FilesClient(conn.getToken);
          const result = await files.listFiles({ query: input.query, folderId: input.folderId, top: input.maxResults });
          return { ok: true as const, result: { files: result } };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
    {
      name: "files.get_file",
      description: "Get metadata for a OneDrive item by ID",
      inputs: z.object({ itemId: z.string() }),
      async handler(input: { itemId: string }) {
        const conn = await deps.getConnectorToken?.("microsoft", MODULE_ID);
        if (!conn) return notConnected();
        try {
          const files = new FilesClient(conn.getToken);
          const file = await files.getFile(input.itemId);
          return { ok: true as const, result: file };
        } catch (e) {
          return upstreamFail(e);
        }
      },
    },
  ],
  skills: [],
  provides: ["email-send", "email-read", "calendar", "onedrive", "microsoft-contacts"],
});

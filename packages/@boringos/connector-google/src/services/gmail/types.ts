// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A single MIME part of a message payload. Gmail nests parts (multipart/
 * mixed → multipart/alternative + attachment parts), so `parts` recurses.
 * Attachment parts carry a `filename` and a `body.attachmentId` to fetch
 * the bytes via `GmailClient.getAttachment`.
 */
export interface MessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MessagePart[];
}

/** Attachment metadata surfaced by `GmailClient.listAttachments`. */
export interface GmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers: { name: string; value: string }[];
    body?: { data?: string; size: number };
    parts?: MessagePart[];
  };
  internalDate: string;
}

export interface Thread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface HistoryEvent {
  id: string;
  messages?: GmailMessage[];
  messagesAdded?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage; labelIds: string[] }[];
  labelsRemoved?: { message: GmailMessage; labelIds: string[] }[];
}

export interface EmailHeaders {
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  returnPath: string | null;
  replyTo: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
}

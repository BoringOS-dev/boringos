# Gmail (via Google Workspace connector)

You can read, search, and send Gmail messages.

## Actions

### list_emails / search_emails

List or search emails. Use Gmail query syntax:

- `from:boss` — emails from a specific sender
- `is:unread` — unread emails
- `subject:invoice` — emails with "invoice" in the subject
- `after:2026/01/01` — emails after a date
- `has:attachment` — emails with attachments

`maxResults` defaults to 10 if omitted.

### read_email

Read the full content of an email by its message ID. Use `list_emails` first to discover IDs.

### send_email

Send a plain-text email. Provide `to`, `subject`, `body`. Multiple recipients can be comma-separated in `to`.

## Guidelines

- When summarizing email content, do not quote full bodies — extract the important facts
- Always check the sender's domain when handling sensitive content
- Treat unread emails as the primary actionable inbox

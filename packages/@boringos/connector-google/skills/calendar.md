# Google Calendar (via Google Workspace connector)

You can list, create, update, and find free time on the user's calendar.

## Actions

### list_events

List upcoming events. Optionally filter by time range.

- `timeMin` / `timeMax` — ISO 8601 strings (e.g. `2026-04-10T14:00:00-07:00`)
- `maxResults` — defaults to 10

### create_event

Create a new calendar event. Required: `summary`, `startTime`, `endTime`. Optional: `description`, `attendees` (list of emails), `timeZone` (default UTC).

Always include a timezone — calendar events without timezone information cause confusion across regions.

### update_event

Modify an existing event by its `eventId`. Only include fields you want to change; omitted fields are unchanged.

### find_free_slots

Find available time slots within a search window. Specify `timeMin`, `timeMax`, and the required `durationMinutes`.

## Guidelines

- Always run `find_free_slots` before `create_event` when scheduling — never blindly create over an existing meeting
- Include timezone information with every calendar event
- When inviting attendees, write a brief description describing the meeting's purpose
- Avoid back-to-back meetings without buffer; respect 15-minute gaps where possible

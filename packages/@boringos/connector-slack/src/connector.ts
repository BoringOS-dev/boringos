import { createHmac } from "node:crypto";
import type {
  ConnectorDefinition,
  ConnectorCredentials,
  WebhookRequest,
  WebhookResponse,
  ConnectorEvent,
} from "@boringos/connector";
import { SlackClient } from "./client.js";

export interface SlackConfig {
  signingSecret: string;
}

export function slack(config: SlackConfig): ConnectorDefinition {
  return {
    kind: "slack",
    name: "Slack",
    description: "Send and receive messages in Slack channels and threads.",

    oauth: {
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: [
        "channels:history",
        "channels:read",
        "chat:write",
        "reactions:read",
        "reactions:write",
        "users:read",
      ],
    },

    events: [
      { type: "message_received", description: "A message was posted in a channel the bot is in" },
      { type: "mention", description: "The bot was @mentioned" },
      { type: "reaction_added", description: "A reaction was added to a message" },
    ],

    actions: [
      {
        name: "send_message",
        description: "Send a message to a Slack channel",
        inputs: {
          channel: { type: "string", description: "Channel ID or name", required: true },
          text: { type: "string", description: "Message text (supports Slack markdown)", required: true },
        },
        outputs: {
          ts: { type: "string", description: "Message timestamp" },
          channel: { type: "string", description: "Channel ID" },
        },
      },
      {
        name: "reply_in_thread",
        description: "Reply to a message in a thread",
        inputs: {
          channel: { type: "string", description: "Channel ID", required: true },
          threadTs: { type: "string", description: "Parent message timestamp", required: true },
          text: { type: "string", description: "Reply text", required: true },
        },
      },
      {
        name: "add_reaction",
        description: "Add an emoji reaction to a message",
        inputs: {
          channel: { type: "string", description: "Channel ID", required: true },
          timestamp: { type: "string", description: "Message timestamp", required: true },
          emoji: { type: "string", description: "Emoji name (without colons)", required: true },
        },
      },
    ],

    createClient(credentials: ConnectorCredentials) {
      return new SlackClient(credentials);
    },

    async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
      const body = req.body as Record<string, unknown>;

      // URL verification challenge
      if (body.type === "url_verification") {
        return { status: 200, body: { challenge: body.challenge } };
      }

      // Verify signature
      if (!verifySlackSignature(req, config.signingSecret)) {
        return { status: 401, body: { error: "Invalid signature" } };
      }

      // Process events
      if (body.type === "event_callback") {
        const event = body.event as Record<string, unknown>;
        const events: ConnectorEvent[] = [];

        if (event.type === "message" && !event.bot_id) {
          events.push({
            connectorKind: "slack",
            type: "message_received",
            tenantId: req.tenantId,
            data: {
              channel: event.channel,
              user: event.user,
              text: event.text,
              ts: event.ts,
              threadTs: event.thread_ts,
            },
            timestamp: new Date(),
          });
        }

        if (event.type === "app_mention") {
          events.push({
            connectorKind: "slack",
            type: "mention",
            tenantId: req.tenantId,
            data: {
              channel: event.channel,
              user: event.user,
              text: event.text,
              ts: event.ts,
            },
            timestamp: new Date(),
          });
        }

        if (event.type === "reaction_added") {
          events.push({
            connectorKind: "slack",
            type: "reaction_added",
            tenantId: req.tenantId,
            data: {
              user: event.user,
              reaction: event.reaction,
              item: event.item,
            },
            timestamp: new Date(),
          });
        }

        return { status: 200, body: { ok: true }, events };
      }

      return { status: 200, body: { ok: true } };
    },

    skillMarkdown() {
      return SLACK_SKILL;
    },
  };
}

function verifySlackSignature(req: WebhookRequest, signingSecret: string): boolean {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  // Prevent replay attacks (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${typeof req.body === "string" ? req.body : JSON.stringify(req.body)}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  return signature === expected;
}

const SLACK_SKILL = `# Slack Connector

You can interact with Slack channels and threads.

## Available Actions

### send_message
Send a message to a Slack channel.
- **channel** (required) — Channel ID (e.g., "C01234567") or name
- **text** (required) — Message text. Supports Slack markdown: *bold*, _italic_, \`code\`, \`\`\`code blocks\`\`\`

### reply_in_thread
Reply to an existing message in a thread.
- **channel** (required) — Channel ID
- **threadTs** (required) — The timestamp of the parent message
- **text** (required) — Reply text

### add_reaction
Add an emoji reaction to a message.
- **channel** (required) — Channel ID
- **timestamp** (required) — Message timestamp
- **emoji** (required) — Emoji name without colons (e.g., "thumbsup", "eyes", "white_check_mark")

## Guidelines

- Keep messages concise and actionable
- Use threads for follow-up discussions, not new top-level messages
- Use reactions to acknowledge messages without creating noise
- Format code snippets in code blocks
- @mention users only when their attention is needed
`;

# @boringos/connector-slack

Slack connector for BoringOS -- messages, threads, reactions, and webhook verification.

## Install

```bash
npm install @boringos/connector-slack
```

## Usage

```typescript
import { BoringOS } from "@boringos/core";
import { slack } from "@boringos/connector-slack";

const app = new BoringOS({});

app.connector(
  slack({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    botToken: process.env.SLACK_BOT_TOKEN!,
  })
);

await app.listen(3000);
```

### Direct Client Usage

```typescript
import { SlackClient } from "@boringos/connector-slack";

const client = new SlackClient(credentials);

// Send a message
await client.sendMessage({ channel: "#general", text: "Hello from BoringOS!" });

// Reply in a thread
await client.replyInThread({ channel: "#general", threadTs: "1234.5678", text: "Reply" });

// Add a reaction
await client.addReaction({ channel: "#general", timestamp: "1234.5678", name: "thumbsup" });
```

## API Reference

### Connector

| Export | Description |
|---|---|
| `slack(config)` | Slack connector definition |

### Actions

| Action | Description |
|---|---|
| `send_message` | Send a message to a channel |
| `reply_in_thread` | Reply to a message thread |
| `add_reaction` | Add an emoji reaction |

### Events

| Event | Description |
|---|---|
| `message_received` | New message in a channel |
| `mention` | Bot was mentioned |
| `reaction_added` | Reaction added to a message |

### Webhook

The connector includes Slack signature verification to validate incoming webhooks.

### Types

`SlackConfig`, `SlackClient`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

# create-boringos

CLI generator for scaffolding new BoringOS projects.

## Usage

```bash
npx create-boringos my-app
```

### Templates

**Minimal** (default) -- `@boringos/core` only, 20-line `index.ts`, boots with zero config:

```bash
npx create-boringos my-app
```

**Full** -- includes memory, Slack, Google, BullMQ, and custom context provider example:

```bash
npx create-boringos my-app --full
# or
npx create-boringos my-app --template full
```

### What Gets Generated

```
my-app/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
├── .env.example
├── .gitignore
└── README.md
```

The generator automatically:
- Replaces template variables (`{{name}}`) with your project name
- Detects your package manager (pnpm, yarn, or npm)
- Runs `install` after scaffolding

## Options

```
npx create-boringos <project-name> [options]

Options:
  --template <minimal|full>   Template to use (default: minimal)
  --full                      Shorthand for --template full
  --help                      Show help
```

## Generated Project

The minimal template produces a working BoringOS server:

```typescript
import { BoringOS } from "@boringos/core";

const app = new BoringOS({});
await app.listen(3000);
```

The full template includes all integrations pre-configured with environment variables:

```typescript
import { BoringOS, createHebbsMemory } from "@boringos/core";
import { slack } from "@boringos/connector-slack";
import { google } from "@boringos/connector-google";
import { createBullMQQueue } from "@boringos/pipeline";

const app = new BoringOS({
  auth: { adminKey: process.env.ADMIN_KEY },
});

app
  .memory(createHebbsMemory({ endpoint: process.env.HEBBS_ENDPOINT }))
  .connector(slack({ signingSecret: process.env.SLACK_SIGNING_SECRET }))
  .connector(google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }))
  .queue(createBullMQQueue({ redis: process.env.REDIS_URL }));

await app.listen(3000);
```

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

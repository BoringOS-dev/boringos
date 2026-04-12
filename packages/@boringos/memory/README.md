# @boringos/memory

Pluggable cognitive memory system for BoringOS agents.

## Install

```bash
npm install @boringos/memory
```

## Usage

```typescript
import { createHebbsMemory, nullMemory } from "@boringos/memory";
import type { MemoryProvider } from "@boringos/memory";

// Production: Hebbs-backed memory
const memory = createHebbsMemory({
  endpoint: "https://api.hebbs.ai",
  apiKey: "hb_...",
  workspace: "my-workspace",
});

// Store a memory
await memory.remember("The deploy key rotates every 90 days", {
  tags: ["ops", "security"],
});

// Recall relevant memories
const results = await memory.recall("deploy key rotation", { limit: 5 });

// Prime memory with bulk context
await memory.prime("onboarding", largeDocument);

// Development: no-op provider (default)
const devMemory = nullMemory;
await devMemory.remember("ignored"); // silently does nothing
```

## API Reference

### Providers

| Export | Description |
|---|---|
| `createHebbsMemory(config)` | Hebbs HTTP client implementing `MemoryProvider` |
| `nullMemory` | No-op provider, safe default for development |

### `MemoryProvider` Interface

| Method | Description |
|---|---|
| `remember(text, meta?)` | Store a memory with optional metadata |
| `recall(query, options?)` | Retrieve relevant memories by semantic search |
| `prime(namespace, content)` | Bulk-load context into memory |
| `forget(query)` | Remove matching memories |
| `ping()` | Health check |
| `skillMarkdown()` | Returns instructions teaching agents how to use memory |

### Types

`MemoryProvider`, `MemoryMeta`, `RecallOptions`, `RecallResult`, `HebbsMemoryConfig`

### Errors

`MemoryConnectionError`, `MemoryAuthError`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

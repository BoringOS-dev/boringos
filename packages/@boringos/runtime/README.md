# @boringos/runtime

Agent execution backends for BoringOS. Each runtime spawns a CLI subprocess -- agents are always agentic CLI tools, never raw LLM API calls.

## Install

```bash
npm install @boringos/runtime
```

## Usage

```typescript
import {
  createRuntimeRegistry,
  claudeRuntime,
  geminiRuntime,
  spawnAgent,
  detectCli,
} from "@boringos/runtime";

// Create a registry and register runtimes
const registry = createRuntimeRegistry();
registry.register(claudeRuntime);
registry.register(geminiRuntime);

// Check if a CLI is available
const hasClaude = await detectCli("claude");

// Get a runtime and test its environment
const runtime = registry.get("claude");
const health = await runtime.testEnvironment({});

// Execute an agent run
const result = await runtime.execute(
  { agent, task, contextMarkdown, workDir: "/tmp/workspace" },
  {
    onOutputLine: (line) => console.log(line),
    onStderrLine: (line) => console.error(line),
    onCostEvent: (cost) => console.log("Tokens:", cost),
  }
);
```

## API Reference

### Registry

| Export | Description |
|---|---|
| `createRuntimeRegistry()` | Injectable registry with alias resolution |

### Built-in Runtimes

| Runtime | CLI | Description |
|---|---|---|
| `claudeRuntime` | `claude` | Anthropic Claude Code |
| `chatgptRuntime` | `chatgpt` | OpenAI ChatGPT CLI |
| `geminiRuntime` | `gemini` | Google Gemini CLI |
| `ollamaRuntime` | `ollama` | Local models via Ollama |
| `commandRuntime` | (any) | Arbitrary shell commands |
| `webhookRuntime` | (HTTP) | HTTP webhook-based execution |

### Utilities

| Function | Description |
|---|---|
| `spawnAgent(cmd, args, opts)` | Spawn subprocess with stdin/stdout/stderr streaming |
| `buildAgentEnv(ctx)` | Build environment variables for agent subprocess |
| `detectCli(name)` | Check if a CLI tool is available on PATH |

### Key Types

`RuntimeModule`, `RuntimeExecutionContext`, `RuntimeExecutionResult`, `AgentRunCallbacks`, `CostEvent`, `RuntimeRegistry`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

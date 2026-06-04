import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

// Default model when neither a per-agent `agents.model` override nor
// `BORINGOS_MODEL` is set. Haiku is the cheapest tier — the framework
// defaults to it so a fresh deploy doesn't burn Opus/Sonnet tokens on
// routine wakes. Operators bump individual agents up via the per-agent
// model picker (Settings → Agents) when a task needs the bigger model.
export const CLAUDE_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const claudeRuntime: RuntimeModule = {
  type: "claude",

  models: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (default)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  ],

  skillMarkdown() {
    return "This agent runs on Claude Code CLI. It can read/write files, run shell commands, and use MCP tools.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | string[] | undefined>;
    const command = (config.command as string) ?? "claude";
    // Fall back to Haiku when nothing upstream set a model. The engine
    // only populates config.model from BORINGOS_MODEL or the per-agent
    // agents.model override, so an un-overridden agent lands on Haiku.
    const model = (config.model as string | undefined) ?? CLAUDE_DEFAULT_MODEL;
    const cwd = ctx.workspaceCwd ?? process.cwd();

    const args = ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (model) args.push("--model", model);
    if (ctx.previousSessionId) args.push("--resume", ctx.previousSessionId);

    const extraArgs = config.extraArgs as string[] | undefined;
    if (extraArgs) args.push(...extraArgs);

    let systemPromptFile: string | undefined;
    let tempDir: string | undefined;

    try {
      if (ctx.systemInstructions) {
        tempDir = await mkdtemp(join(tmpdir(), "boringos-"));
        systemPromptFile = join(tempDir, "system-prompt.md");
        await writeFile(systemPromptFile, ctx.systemInstructions, "utf8");
        args.push("--append-system-prompt-file", systemPromptFile);
      }

      const env = buildAgentEnv(ctx);
      let sessionId: string | undefined;
      let lastCostEvent: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; model: string; costUsd?: number } | undefined;

      const result = await spawnAgent({
        command,
        args,
        cwd,
        env,
        stdin: ctx.contextMarkdown,
        onOutputLine: async (line) => {
          try {
            const event = JSON.parse(line);
            if (event.type === "result" && event.session_id) {
              sessionId = event.session_id;
            }
            if (event.type === "result" && event.usage) {
              lastCostEvent = {
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: event.usage.output_tokens ?? 0,
                cacheCreationTokens: event.usage.cache_creation_input_tokens ?? 0,
                cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
                model: event.model ?? model ?? "claude",
                costUsd: event.total_cost_usd,
              };
            }
          } catch {
            // Not JSON — raw text output
          }
          await callbacks.onOutputLine(line);
        },
        onStderrLine: callbacks.onStderrLine,
      });

      if (lastCostEvent) callbacks.onCostEvent(lastCostEvent);
      const errorCode = result.idleTimedOut ? "stalled" : undefined;
      callbacks.onComplete({ exitCode: result.exitCode, sessionId, errorCode });

      return {
        exitCode: result.exitCode,
        sessionId,
        errorCode,
        usage: lastCostEvent ? {
          inputTokens: lastCostEvent.inputTokens,
          outputTokens: lastCostEvent.outputTokens,
        } : undefined,
        costUsd: lastCostEvent?.costUsd,
        model: lastCostEvent?.model ?? model,
        provider: "anthropic",
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    } finally {
      if (systemPromptFile) await unlink(systemPromptFile).catch(() => {});
      if (tempDir) {
        const { rmdir } = await import("node:fs/promises");
        await rmdir(tempDir).catch(() => {});
      }
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("claude");
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "claude_cli_available",
        level: available ? "info" as const : "error" as const,
        message: available ? "Claude CLI found on PATH" : "Claude CLI not found",
        hint: available ? undefined : "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code",
      }],
      testedAt: new Date().toISOString(),
    };
  },
};

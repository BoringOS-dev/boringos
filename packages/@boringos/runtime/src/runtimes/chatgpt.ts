import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

export const chatgptRuntime: RuntimeModule = {
  type: "chatgpt",

  models: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "o3", label: "o3" },
    { id: "codex-mini", label: "Codex Mini" },
  ],

  skillMarkdown() {
    return "This agent runs on OpenAI Codex CLI.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | undefined>;
    const command = config.command ?? "codex";
    const cwd = ctx.workspaceCwd ?? process.cwd();

    const args = ["--quiet"];
    if (config.model) args.push("--model", config.model);

    try {
      const env = buildAgentEnv(ctx);
      const result = await spawnAgent({
        command,
        args,
        cwd,
        env,
        stdin: ctx.contextMarkdown,
        onOutputLine: callbacks.onOutputLine,
        onStderrLine: callbacks.onStderrLine,
      });

      callbacks.onComplete({ exitCode: result.exitCode });
      return { exitCode: result.exitCode, provider: "openai" };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("codex");
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "codex_cli_available",
        level: available ? "info" as const : "error" as const,
        message: available ? "Codex CLI found on PATH" : "Codex CLI not found",
        hint: available ? undefined : "Install: npm install -g @openai/codex",
      }],
      testedAt: new Date().toISOString(),
    };
  },
};

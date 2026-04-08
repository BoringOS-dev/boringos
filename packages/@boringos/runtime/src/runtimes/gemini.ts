import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

export const geminiRuntime: RuntimeModule = {
  type: "gemini",

  models: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],

  skillMarkdown() {
    return "This agent runs on Google Gemini CLI.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | undefined>;
    const command = config.command ?? "gemini";
    const cwd = ctx.workspaceCwd ?? process.cwd();

    const args: string[] = [];
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
      return { exitCode: result.exitCode, provider: "google" };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("gemini");
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "gemini_cli_available",
        level: available ? "info" as const : "error" as const,
        message: available ? "Gemini CLI found on PATH" : "Gemini CLI not found",
        hint: available ? undefined : "Install: npm install -g @anthropic-ai/gemini-cli",
      }],
      testedAt: new Date().toISOString(),
    };
  },
};

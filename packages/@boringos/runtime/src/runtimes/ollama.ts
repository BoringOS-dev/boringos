import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv, detectCli } from "../spawn.js";

export const ollamaRuntime: RuntimeModule = {
  type: "ollama",

  skillMarkdown() {
    return "This agent runs on a local Ollama model.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | undefined>;
    const command = config.command ?? "ollama";
    const model = config.model ?? "llama3.1";
    const cwd = ctx.workspaceCwd ?? process.cwd();

    const args = ["run", model];

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
      return { exitCode: result.exitCode, model, provider: "ollama" };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    }
  },

  async testEnvironment() {
    const { available } = await detectCli("ollama");
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "ollama_cli_available",
        level: available ? "info" as const : "error" as const,
        message: available ? "Ollama found on PATH" : "Ollama not found",
        hint: available ? undefined : "Install: https://ollama.ai",
      }],
      testedAt: new Date().toISOString(),
    };
  },

  async listModels() {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const { stdout } = await exec("ollama", ["list"]);
      return stdout.split("\n").slice(1).filter(Boolean).map((line) => {
        const name = line.split(/\s+/)[0] ?? "";
        return { id: name, label: name };
      });
    } catch {
      return [];
    }
  },
};

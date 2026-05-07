import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";
import { spawnAgent, buildAgentEnv } from "../spawn.js";

export const commandRuntime: RuntimeModule = {
  type: "command",

  skillMarkdown() {
    return "This agent runs as a generic CLI subprocess.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | string[] | undefined>;
    const command = config.command as string;
    if (!command) {
      const err = new Error("command runtime requires a 'command' in config");
      callbacks.onError(err);
      return { exitCode: 1, errorMessage: err.message };
    }

    const args = (config.args as string[]) ?? [];
    const cwd = ctx.workspaceCwd ?? process.cwd();

    try {
      const env = buildAgentEnv(ctx);
      // Combine system instructions with context markdown
      const fullInput = ctx.systemInstructions
        ? `${ctx.systemInstructions}\n\n${ctx.contextMarkdown}`
        : ctx.contextMarkdown;
      const result = await spawnAgent({
        command,
        args,
        cwd,
        env,
        stdin: fullInput,
        onOutputLine: callbacks.onOutputLine,
        onStderrLine: callbacks.onStderrLine,
      });

      callbacks.onComplete({ exitCode: result.exitCode });
      return { exitCode: result.exitCode, provider: "command" };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    }
  },

  async testEnvironment(config: Record<string, unknown>) {
    const command = config.command as string | undefined;
    if (!command) {
      return {
        status: "fail" as const,
        checks: [{ code: "command_not_configured", level: "error" as const, message: "No command configured" }],
        testedAt: new Date().toISOString(),
      };
    }

    const { detectCli } = await import("../spawn.js");
    const { available } = await detectCli(command);
    return {
      status: available ? "pass" as const : "fail" as const,
      checks: [{
        code: "command_available",
        level: available ? "info" as const : "error" as const,
        message: available ? `${command} found on PATH` : `${command} not found`,
      }],
      testedAt: new Date().toISOString(),
    };
  },
};

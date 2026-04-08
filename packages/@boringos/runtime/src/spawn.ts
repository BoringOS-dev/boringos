import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import type { AgentRunCallbacks, RuntimeExecutionContext } from "./types.js";

const execFileAsync = promisify(execFile);

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  onOutputLine?: AgentRunCallbacks["onOutputLine"];
  onStderrLine?: AgentRunCallbacks["onStderrLine"];
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function buildAgentEnv(ctx: RuntimeExecutionContext): Record<string, string> {
  const env: Record<string, string> = {
    BORINGOS_CALLBACK_URL: ctx.callbackUrl,
    BORINGOS_CALLBACK_TOKEN: ctx.callbackToken,
    BORINGOS_RUN_ID: ctx.runId,
    BORINGOS_AGENT_ID: ctx.agentId,
    BORINGOS_TENANT_ID: ctx.tenantId,
  };

  if (ctx.taskId) env["BORINGOS_TASK_ID"] = ctx.taskId;
  if (ctx.wakeReason) env["BORINGOS_WAKE_REASON"] = ctx.wakeReason;
  if (ctx.workspaceCwd) env["BORINGOS_WORKSPACE_CWD"] = ctx.workspaceCwd;
  if (ctx.workspaceBranch) env["BORINGOS_WORKSPACE_BRANCH"] = ctx.workspaceBranch;

  if (ctx.extraEnv) {
    for (const [k, v] of Object.entries(ctx.extraEnv)) {
      env[k] = v;
    }
  }

  return env;
}

export async function spawnAgent(opts: SpawnOptions): Promise<SpawnResult> {
  const effectiveEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") effectiveEnv[k] = v;
  }
  for (const [k, v] of Object.entries(opts.env)) {
    effectiveEnv[k] = v;
  }

  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: effectiveEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
    }, opts.timeoutMs);
  }

  if (child.stdin && opts.stdin) {
    child.stdin.write(opts.stdin, "utf8");
    child.stdin.end();
  }

  const processStream = async (stream: Readable, lines: string[], cb?: (line: string) => void | Promise<void>) => {
    let buffer = "";
    for await (const chunk of stream) {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        lines.push(line);
        if (cb) await cb(line);
      }
    }
    if (buffer) {
      lines.push(buffer);
      if (cb) await cb(buffer);
    }
  };

  const stdoutP = child.stdout ? processStream(child.stdout, stdoutLines, opts.onOutputLine) : Promise.resolve();
  const stderrP = child.stderr ? processStream(child.stderr, stderrLines, opts.onStderrLine) : Promise.resolve();

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  await Promise.all([stdoutP, stderrP]);
  if (timeoutHandle) clearTimeout(timeoutHandle);

  return { exitCode, stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n") };
}

export async function detectCli(command: string): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync("which", [command]);
    return { available: stdout.trim().length > 0 };
  } catch {
    return { available: false };
  }
}

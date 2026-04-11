import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface CopilotConfig {
  /** CLI command to run (default: "claude") */
  runtime?: string;
  /** Working directory for the CLI */
  workingDir?: string;
  /** Extra environment variables */
  env?: Record<string, string>;
}

export interface CopilotManager {
  start(cols?: number, rows?: number): void;
  stop(): void;
  isRunning(): boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (code: number) => void): void;
}

/**
 * Creates a copilot session manager that spawns a CLI subprocess.
 * Uses child_process.spawn with piped stdio.
 * Falls back to node-pty if available for full TTY support.
 */
export function createCopilotManager(config: CopilotConfig): CopilotManager {
  let proc: ChildProcess | null = null;
  let ptyProc: any = null; // node-pty IPty if available
  let dataHandler: ((data: string) => void) | null = null;
  let exitHandler: ((code: number) => void) | null = null;
  let usePty = false;

  // Try to load node-pty for full TTY support.
  // node-pty is a native module — use createRequire pointed at the app's
  // working directory so it resolves from the app's node_modules, not the framework's.
  let ptyModule: any = null;
  try {
    const { createRequire } = require("node:module");
    const cwd = config.workingDir ?? process.cwd();
    const appRequire = createRequire(cwd + "/package.json");
    ptyModule = appRequire("node-pty");
    usePty = true;
  } catch {
    // node-pty not available — fall back to child_process.spawn
  }

  return {
    start(cols = 120, rows = 40) {
      if (proc || ptyProc) return;

      const runtimeName = config.runtime ?? "claude";
      const cwd = config.workingDir ?? process.cwd();

      // Resolve full path
      let command = runtimeName;
      try {
        command = execSync(`which ${runtimeName}`, { encoding: "utf8" }).trim() || runtimeName;
      } catch {}

      const env = {
        ...process.env,
        ...config.env,
        TERM: "xterm-256color",
        COLUMNS: String(cols),
        LINES: String(rows),
      } as Record<string, string>;

      if (usePty && ptyModule) {
        try {
          ptyProc = ptyModule.spawn(command, [], { name: "xterm-256color", cols, rows, cwd, env });
          ptyProc.onData((data: string) => dataHandler?.(data));
          ptyProc.onExit(({ exitCode }: { exitCode: number }) => { ptyProc = null; exitHandler?.(exitCode); });
          return;
        } catch {
          // PTY failed, fall back
          ptyProc = null;
        }
      }

      // Fallback: plain subprocess
      proc = spawn(command, [], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });

      proc.stdout?.on("data", (data: Buffer) => dataHandler?.(data.toString()));
      proc.stderr?.on("data", (data: Buffer) => dataHandler?.(data.toString()));
      proc.on("exit", (code) => { proc = null; exitHandler?.(code ?? 1); });
    },

    stop() {
      if (ptyProc) { ptyProc.kill(); ptyProc = null; }
      if (proc) { proc.kill(); proc = null; }
    },

    isRunning() {
      return proc !== null || ptyProc !== null;
    },

    write(data: string) {
      if (ptyProc) { ptyProc.write(data); return; }
      proc?.stdin?.write(data);
    },

    resize(cols: number, rows: number) {
      if (ptyProc) { ptyProc.resize(cols, rows); }
      // Can't resize a plain subprocess
    },

    onData(handler: (data: string) => void) {
      dataHandler = handler;
    },

    onExit(handler: (code: number) => void) {
      exitHandler = handler;
    },
  };
}

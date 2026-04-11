import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { execSync } from "node:child_process";

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
 * Creates a copilot session manager that spawns a CLI in a PTY.
 * The CLI runs interactively — stdin/stdout piped via handlers.
 */
export function createCopilotManager(config: CopilotConfig): CopilotManager {
  let process: IPty | null = null;
  let dataHandler: ((data: string) => void) | null = null;
  let exitHandler: ((code: number) => void) | null = null;

  return {
    start(cols = 120, rows = 40) {
      if (process) return;

      const runtimeName = config.runtime ?? "claude";
      const cwd = config.workingDir ?? globalThis.process.cwd();

      // Resolve full path — PTY doesn't inherit shell profile so ~/.local/bin etc may be missing
      let command = runtimeName;
      try {
        command = execSync(`which ${runtimeName}`, { encoding: "utf8" }).trim() || runtimeName;
      } catch {
        // Fall back to the name and hope PATH has it
      }

      process = pty.spawn(command, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: {
          ...globalThis.process.env,
          ...config.env,
          TERM: "xterm-256color",
        } as Record<string, string>,
      });

      process.onData((data) => {
        dataHandler?.(data);
      });

      process.onExit(({ exitCode }) => {
        process = null;
        exitHandler?.(exitCode);
      });
    },

    stop() {
      if (process) {
        process.kill();
        process = null;
      }
    },

    isRunning() {
      return process !== null;
    },

    write(data: string) {
      process?.write(data);
    },

    resize(cols: number, rows: number) {
      process?.resize(cols, rows);
    },

    onData(handler: (data: string) => void) {
      dataHandler = handler;
    },

    onExit(handler: (code: number) => void) {
      exitHandler = handler;
    },
  };
}

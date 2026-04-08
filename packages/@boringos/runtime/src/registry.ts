import type { RuntimeModule, RuntimeRegistry } from "./types.js";

const ALIASES: Record<string, string> = {
  claude_local: "claude",
  "claude-local": "claude",
  codex_local: "chatgpt",
  "codex-local": "chatgpt",
  process: "command",
  http: "webhook",
};

export function createRuntimeRegistry(): RuntimeRegistry {
  const modules = new Map<string, RuntimeModule>();

  return {
    register(module: RuntimeModule) {
      modules.set(module.type, module);
    },

    get(type: string): RuntimeModule | undefined {
      const resolved = ALIASES[type] ?? type;
      return modules.get(resolved) ?? modules.get("claude");
    },

    list(): RuntimeModule[] {
      return Array.from(modules.values());
    },

    has(type: string): boolean {
      const resolved = ALIASES[type] ?? type;
      return modules.has(resolved);
    },
  };
}

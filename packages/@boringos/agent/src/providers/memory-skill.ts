import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const memorySkillProvider: ContextProvider = {
  name: "memory-skill",
  phase: "system",
  priority: 40,

  async provide(event: ContextBuildEvent): Promise<string | null> {
    if (!event.memory) return null;
    return event.memory.skillMarkdown();
  },
};

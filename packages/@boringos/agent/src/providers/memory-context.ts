import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const memoryContextProvider: ContextProvider = {
  name: "memory-context",
  phase: "context",
  priority: 50,

  async provide(event: ContextBuildEvent): Promise<string | null> {
    if (!event.memory) return null;

    try {
      const context = event.taskId
        ? `Agent ${event.agent.name} working on task ${event.taskId}`
        : `Agent ${event.agent.name} woken for ${event.wakeReason}`;

      const result = await event.memory.prime(context, { entityId: event.agent.id });
      if (!result) return null;

      return `## Relevant Memory\n\n${result}`;
    } catch {
      return null;
    }
  },
};

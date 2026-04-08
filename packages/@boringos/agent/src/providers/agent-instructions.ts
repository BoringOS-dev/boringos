import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const agentInstructionsProvider: ContextProvider = {
  name: "agent-instructions",
  phase: "system",
  priority: 50,

  async provide(event: ContextBuildEvent): Promise<string | null> {
    const instructions = event.agent.instructions;
    if (!instructions) return null;

    return `## Additional Instructions\n\n${instructions}`;
  },
};

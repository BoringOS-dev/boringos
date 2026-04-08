import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const headerProvider: ContextProvider = {
  name: "header",
  phase: "system",
  priority: 0,

  async provide(event: ContextBuildEvent): Promise<string> {
    const { agent } = event;
    return [
      `# Agent: ${agent.name}`,
      `- **ID:** ${agent.id}`,
      `- **Role:** ${agent.role}`,
      `- **Tenant:** ${event.tenantId}`,
      agent.title ? `- **Title:** ${agent.title}` : null,
    ].filter(Boolean).join("\n");
  },
};

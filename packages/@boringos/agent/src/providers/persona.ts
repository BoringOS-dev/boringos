import type { ContextProvider, ContextBuildEvent } from "../types.js";
import { loadPersonaBundle, mergePersonaBundle } from "../persona-loader.js";

export const personaProvider: ContextProvider = {
  name: "persona",
  phase: "system",
  priority: 10,

  async provide(event: ContextBuildEvent): Promise<string | null> {
    const bundle = await loadPersonaBundle(event.agent.role);
    const merged = mergePersonaBundle(bundle);
    return merged || null;
  },
};

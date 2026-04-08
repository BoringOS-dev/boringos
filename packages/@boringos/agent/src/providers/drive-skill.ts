import type { ContextProvider, ContextBuildEvent } from "../types.js";
import type { StorageBackend } from "@boringos/drive";

export function createDriveSkillProvider(deps: { drive: StorageBackend | null }): ContextProvider {
  return {
    name: "drive-skill",
    phase: "system",
    priority: 30,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      if (!deps.drive) return null;

      const skill = deps.drive.skillMarkdown();
      if (!skill) return null;

      return `## Drive Skill — File Organization Rules\n\n${skill}`;
    },
  };
}

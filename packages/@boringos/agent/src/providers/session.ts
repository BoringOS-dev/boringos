import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const sessionProvider: ContextProvider = {
  name: "session",
  phase: "context",
  priority: 0,

  async provide(event: ContextBuildEvent): Promise<string | null> {
    // Mode A: Session handoff (resuming a previous session)
    if (event.previousSessionId) {
      const lines = [
        "## Session Handoff",
        "",
        `You are resuming a previous session (ID: ${event.previousSessionId.slice(0, 12)}...).`,
        `Wake reason: **${event.wakeReason}**`,
      ];
      if (event.previousSessionSummary) {
        lines.push("", "### What happened last run", "", event.previousSessionSummary);
      }
      return lines.join("\n");
    }

    // Mode B: Session summary fallback (session expired but summary exists)
    if (event.previousSessionSummary) {
      return [
        "## Prior Context",
        "",
        "Your previous session could not be resumed, but here is a summary of your last run:",
        "",
        event.previousSessionSummary,
      ].join("\n");
    }

    // Mode C: First run orientation
    if (event.taskId) {
      return [
        "## First Run",
        "",
        "This is your first run. Take a moment to orient yourself:",
        "1. Read the task details below carefully",
        "2. Explore the workspace if one is provided",
        "3. Post a brief plan as a comment before starting work",
      ].join("\n");
    }

    return null;
  },
};

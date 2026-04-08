import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createTaskProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "task",
    phase: "context",
    priority: 10,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      if (!event.taskId) {
        return `You are **${event.agent.name}**. Wake reason: **${event.wakeReason}**. Check your assigned tasks and proceed.`;
      }

      try {
        const { eq } = await import("drizzle-orm");
        const { tasks } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const rows = await db.select().from(tasks).where(eq(tasks.id, event.taskId)).limit(1);
        const task = rows[0];
        if (!task) return `Task ${event.taskId} not found.`;

        const parts = [
          `## Task: ${task.identifier ? `${task.identifier}: ` : ""}${task.title}`,
        ];
        if (task.description) {
          parts.push("", task.description);
        }
        parts.push("", `**Status:** ${task.status} | **Priority:** ${task.priority}`);

        return parts.join("\n");
      } catch {
        return null;
      }
    },
  };
}

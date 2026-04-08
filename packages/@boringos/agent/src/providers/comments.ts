import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createCommentsProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "comments",
    phase: "context",
    priority: 20,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      if (!event.taskId) return null;

      try {
        const { eq, desc } = await import("drizzle-orm");
        const { taskComments } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const comments = await db
          .select()
          .from(taskComments)
          .where(eq(taskComments.taskId, event.taskId))
          .orderBy(desc(taskComments.createdAt))
          .limit(10);

        if (comments.length === 0) return null;

        const lines = ["## Recent Comments", ""];
        for (const c of comments.reverse()) {
          const author = c.authorAgentId ? `Agent ${c.authorAgentId.slice(0, 8)}` : "User";
          lines.push(`**${author}:** ${c.body}`, "");
        }

        return lines.join("\n");
      } catch {
        return null;
      }
    },
  };
}

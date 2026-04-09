import { eq } from "drizzle-orm";
import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createHierarchyProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "hierarchy",
    phase: "system",
    priority: 15, // after header (0), before tenant guidelines (20)

    async provide(event: ContextBuildEvent): Promise<string | null> {
      try {
        const { eq: eqOp } = await import("drizzle-orm");
        const { agents } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const agent = event.agent;
        const lines: string[] = ["## Your Organization"];

        // Find boss
        if (agent.reportsTo) {
          const bossRows = await db.select().from(agents).where(eqOp(agents.id, agent.reportsTo)).limit(1);
          if (bossRows[0]) {
            lines.push(`- **You report to:** ${bossRows[0].name} (${bossRows[0].role})`);
            lines.push(`- When stuck or blocked, escalate to your manager.`);
          }
        } else {
          lines.push(`- You are a **top-level agent** with no manager.`);
        }

        // Find direct reports
        const reports = await db.select().from(agents).where(eqOp(agents.reportsTo, agent.id));
        if (reports.length > 0) {
          lines.push(`- **Your direct reports:**`);
          for (const r of reports) {
            lines.push(`  - ${r.name} (${r.role}) — ${r.status}`);
          }
          lines.push(`- When a task is too large or outside your expertise, delegate to your reports.`);
          lines.push(`- Create subtasks and assign them. Don't do everything yourself.`);
        }

        // Only return if there's actual hierarchy info
        if (lines.length <= 1) return null;

        return lines.join("\n");
      } catch {
        return null;
      }
    },
  };
}

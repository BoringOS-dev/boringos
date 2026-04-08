import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createApprovalProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "approval",
    phase: "context",
    priority: 60,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      if (event.wakeReason !== "approval_resolved") return null;
      if (!event.approvalId) return null;

      try {
        const { eq } = await import("drizzle-orm");
        const { approvals } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const rows = await db.select().from(approvals).where(eq(approvals.id, event.approvalId)).limit(1);
        const approval = rows[0];
        if (!approval) return null;

        const lines = ["## Approval", "", `**Status:** ${approval.status}`];

        if (approval.status === "rejected") {
          lines.push("", `**Rejection reason:** ${approval.decisionNote ?? "No reason given"}`);
          lines.push("", "The approval was rejected. Propose an alternative approach.");
        } else if (approval.decisionNote) {
          lines.push("", `**Conditions:** ${approval.decisionNote}`);
          lines.push("", "These conditions are MANDATORY. Incorporate them into your work.");
        }

        const payload = approval.payload as Record<string, string> | null;
        if (payload?.message) {
          lines.push("", `**Original request:** ${payload.message}`);
        }

        return lines.join("\n");
      } catch {
        return null;
      }
    },
  };
}

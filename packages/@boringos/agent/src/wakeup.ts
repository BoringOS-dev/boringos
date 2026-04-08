import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents, agentWakeupRequests } from "@boringos/db";
import type { WakeRequest, WakeupOutcome } from "./types.js";
import { generateId } from "@boringos/shared";

export async function createWakeup(db: Db, request: WakeRequest): Promise<WakeupOutcome> {
  // Fetch agent
  const agentRows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, request.agentId), eq(agents.tenantId, request.tenantId)))
    .limit(1);

  const agent = agentRows[0];
  if (!agent) return { kind: "agent_not_found" };

  if (agent.status === "paused" || agent.status === "archived") {
    return { kind: "agent_not_invokable", agentStatus: agent.status };
  }

  // Check for existing pending wakeup for same agent + task
  if (request.taskId) {
    const existing = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.agentId, request.agentId),
          eq(agentWakeupRequests.tenantId, request.tenantId),
          eq(agentWakeupRequests.status, "pending"),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // Coalesce — increment count
      await db
        .update(agentWakeupRequests)
        .set({ coalescedCount: (existing[0].coalescedCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(agentWakeupRequests.id, existing[0].id));

      return { kind: "coalesced", existingWakeupRequestId: existing[0].id };
    }
  }

  // Create new wakeup request
  const id = generateId();
  await db.insert(agentWakeupRequests).values({
    id,
    tenantId: request.tenantId,
    agentId: request.agentId,
    taskId: request.taskId,
    reason: request.reason,
    payload: request.payload,
    status: "pending",
  });

  return { kind: "created", wakeupRequestId: id };
}

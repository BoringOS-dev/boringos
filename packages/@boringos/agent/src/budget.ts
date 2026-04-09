import { eq, and, gte, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { budgetPolicies, budgetIncidents, costEvents } from "@boringos/db";
import { generateId } from "@boringos/shared";

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  incident?: { type: string; spentCents: number; limitCents: number };
}

export async function checkBudget(
  db: Db,
  tenantId: string,
  agentId: string,
): Promise<BudgetCheckResult> {
  // Find applicable policies (agent-specific first, then tenant-wide)
  const policies = await db.select().from(budgetPolicies).where(
    and(eq(budgetPolicies.tenantId, tenantId)),
  );

  for (const policy of policies) {
    // Skip if policy is agent-scoped and doesn't match this agent
    if (policy.agentId && policy.agentId !== agentId) continue;

    // Calculate period start
    const periodStart = getPeriodStart(policy.period);

    // Sum spending in period
    const spending = await db.select({
      total: sql<number>`COALESCE(SUM(CAST(cost_usd AS NUMERIC) * 100), 0)`,
    }).from(costEvents).where(
      and(
        eq(costEvents.tenantId, tenantId),
        policy.agentId ? eq(costEvents.agentId, agentId) : undefined,
        gte(costEvents.createdAt, periodStart),
      ),
    );

    const spentCents = Math.round(Number(spending[0]?.total ?? 0));
    const limitCents = policy.limitCents;
    const warnAt = Math.round(limitCents * (policy.warnThresholdPct / 100));

    // Hard stop
    if (spentCents >= limitCents) {
      await db.insert(budgetIncidents).values({
        id: generateId(),
        tenantId,
        policyId: policy.id,
        agentId: policy.agentId ?? undefined,
        type: "hard_stop",
        spentCents,
        limitCents,
      });

      return {
        allowed: false,
        reason: `Budget exceeded: $${(spentCents / 100).toFixed(2)} / $${(limitCents / 100).toFixed(2)}`,
        incident: { type: "hard_stop", spentCents, limitCents },
      };
    }

    // Warning
    if (spentCents >= warnAt) {
      await db.insert(budgetIncidents).values({
        id: generateId(),
        tenantId,
        policyId: policy.id,
        agentId: policy.agentId ?? undefined,
        type: "warning",
        spentCents,
        limitCents,
      });
    }
  }

  return { allowed: true };
}

function getPeriodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "daily":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "weekly": {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    case "monthly":
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

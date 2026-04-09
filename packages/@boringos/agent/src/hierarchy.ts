import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents, tasks } from "@boringos/db";
import { generateId } from "@boringos/shared";

/**
 * Find the best direct report to delegate a task to, based on role matching.
 */
export async function findDelegateForTask(
  db: Db,
  agentId: string,
  taskTitle: string,
): Promise<string | null> {
  const reports = await db.select().from(agents).where(eq(agents.reportsTo, agentId));
  if (reports.length === 0) return null;

  const titleLower = taskTitle.toLowerCase();

  // Simple role matching heuristics
  const roleScores: Record<string, number> = {};
  for (const r of reports) {
    let score = 0;
    if (r.status === "paused" || r.status === "archived") continue;

    // Code/engineering tasks
    if (/code|build|fix|implement|test|bug|feature|deploy|ci|refactor/.test(titleLower) && r.role === "engineer") score += 3;
    if (/devops|infra|deploy|pipeline|docker|k8s/.test(titleLower) && r.role === "devops") score += 3;

    // Research tasks
    if (/research|analyze|investigate|find|explore|discover/.test(titleLower) && r.role === "researcher") score += 3;

    // Design tasks
    if (/design|ux|ui|wireframe|mockup|prototype/.test(titleLower) && r.role === "designer") score += 3;

    // QA tasks
    if (/test|qa|quality|verify|validate|regression/.test(titleLower) && r.role === "qa") score += 3;

    // PM tasks
    if (/plan|roadmap|prioritize|spec|requirement|stakeholder/.test(titleLower) && r.role === "pm") score += 3;

    // Content tasks
    if (/write|content|blog|social|marketing|copy/.test(titleLower) && r.role === "content-creator") score += 3;

    // Finance tasks
    if (/budget|cost|invoice|financial|expense|revenue/.test(titleLower) && r.role === "finance") score += 3;

    // Default: any idle report gets a base score
    if (r.status === "idle") score += 1;

    roleScores[r.id] = score;
  }

  // Pick the best match
  const sorted = Object.entries(roleScores).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[1] > 0 ? sorted[0][0] : reports[0]?.id ?? null;
}

/**
 * Escalate a blocked task to the agent's boss.
 * Creates a new task assigned to the boss explaining the blocker.
 */
export async function escalateToManager(
  db: Db,
  agentId: string,
  blockedTaskId: string,
  reason?: string,
): Promise<string | null> {
  // Find the agent and their boss
  const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = agentRows[0];
  if (!agent?.reportsTo) return null;

  // Get blocked task info
  const taskRows = await db.select().from(tasks).where(eq(tasks.id, blockedTaskId)).limit(1);
  const task = taskRows[0];
  if (!task) return null;

  // Create escalation task for the boss
  const escalationId = generateId();
  await db.insert(tasks).values({
    id: escalationId,
    tenantId: agent.tenantId,
    title: `[Escalation] ${agent.name} blocked on: ${task.title}`,
    description: [
      `Agent **${agent.name}** (${agent.role}) is blocked on task **${task.identifier ?? task.id}**: ${task.title}`,
      "",
      reason ? `**Reason:** ${reason}` : "No reason provided.",
      "",
      `Please review and unblock, then notify ${agent.name} when resolved.`,
    ].join("\n"),
    status: "todo",
    priority: "high",
    assigneeAgentId: agent.reportsTo,
    parentId: blockedTaskId,
    originKind: "escalation",
    originId: blockedTaskId,
  });

  return escalationId;
}

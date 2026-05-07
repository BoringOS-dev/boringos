import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agents } from "@boringos/db";
import { generateId } from "@boringos/shared";
import { loadPersonaBundle, mergePersonaBundle, resolvePersonaRole } from "./persona-loader.js";

// ── Agent templates ──────────────────────────────────────────────────────────

export interface AgentTemplateConfig {
  name?: string;
  tenantId: string;
  runtimeId?: string;
  instructions?: string;
  reportsTo?: string;
  source?: 'shell' | 'user' | 'app';
  sourceAppId?: string;
}

export interface CreatedAgent {
  id: string;
  name: string;
  role: string;
  tenantId: string;
  reportsTo: string | null;
}

/**
 * Create an agent from a role template.
 * Uses the built-in persona bundle to generate default instructions.
 */
export async function createAgentFromTemplate(
  db: Db,
  role: string,
  config: AgentTemplateConfig,
): Promise<CreatedAgent> {
  const resolvedRole = resolvePersonaRole(role);
  const bundle = await loadPersonaBundle(resolvedRole);
  const personaInstructions = mergePersonaBundle(bundle);

  const id = generateId();
  const name = config.name ?? formatRoleName(resolvedRole);

  await db.insert(agents).values({
    id,
    tenantId: config.tenantId,
    name,
    role: resolvedRole,
    instructions: config.instructions ?? personaInstructions.slice(0, 500), // Summary for DB
    runtimeId: config.runtimeId ?? null,
    reportsTo: config.reportsTo ?? null,
    source: config.source ?? 'user',
    sourceAppId: config.sourceAppId ?? null,
  });

  return { id, name, role: resolvedRole, tenantId: config.tenantId, reportsTo: config.reportsTo ?? null };
}

function formatRoleName(role: string): string {
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Team templates ───────────────────────────────────────────────────────────

export interface TeamTemplate {
  name: string;
  description: string;
  roles: Array<{
    role: string;
    name?: string;
    reportsTo?: string; // role name of the boss (resolved within the team)
  }>;
}

export const BUILT_IN_TEAMS: Record<string, TeamTemplate> = {
  engineering: {
    name: "Engineering Team",
    description: "CTO leading a team of engineers and QA.",
    roles: [
      { role: "cto", name: "CTO" },
      { role: "engineer", name: "Senior Engineer", reportsTo: "cto" },
      { role: "engineer", name: "Engineer", reportsTo: "cto" },
      { role: "qa", name: "QA Engineer", reportsTo: "cto" },
    ],
  },
  executive: {
    name: "Executive Team",
    description: "CEO with CTO, PM, and PA.",
    roles: [
      { role: "ceo", name: "CEO" },
      { role: "cto", name: "CTO", reportsTo: "ceo" },
      { role: "pm", name: "Product Manager", reportsTo: "ceo" },
      { role: "personal-assistant", name: "Executive Assistant", reportsTo: "ceo" },
    ],
  },
  content: {
    name: "Content Team",
    description: "Content creator with researcher support.",
    roles: [
      { role: "content-creator", name: "Content Lead" },
      { role: "researcher", name: "Research Analyst", reportsTo: "content-creator" },
    ],
  },
  sales: {
    name: "Sales Team",
    description: "CEO leading researchers and engineers for sales ops.",
    roles: [
      { role: "ceo", name: "Sales Director" },
      { role: "researcher", name: "Lead Researcher", reportsTo: "ceo" },
      { role: "engineer", name: "Sales Engineer", reportsTo: "ceo" },
      { role: "personal-assistant", name: "Sales Coordinator", reportsTo: "ceo" },
    ],
  },
  support: {
    name: "Support Team",
    description: "PM managing QA and engineers for customer support.",
    roles: [
      { role: "pm", name: "Support Manager" },
      { role: "qa", name: "Tier 1 Support", reportsTo: "pm" },
      { role: "engineer", name: "Tier 2 Support", reportsTo: "pm" },
    ],
  },
};

/**
 * Create a full team from a template.
 * Returns all created agents with hierarchy already wired.
 */
export async function createTeam(
  db: Db,
  templateName: string,
  config: { tenantId: string; runtimeId?: string },
): Promise<CreatedAgent[]> {
  const template = BUILT_IN_TEAMS[templateName];
  if (!template) {
    throw new Error(`Unknown team template: ${templateName}. Available: ${Object.keys(BUILT_IN_TEAMS).join(", ")}`);
  }

  const created: CreatedAgent[] = [];
  const roleToId = new Map<string, string>(); // role → first agent ID with that role

  for (const roleDef of template.roles) {
    const reportsTo = roleDef.reportsTo ? roleToId.get(roleDef.reportsTo) : undefined;

    const agent = await createAgentFromTemplate(db, roleDef.role, {
      name: roleDef.name,
      tenantId: config.tenantId,
      runtimeId: config.runtimeId,
      reportsTo,
    });

    created.push(agent);

    // Track first agent per role for hierarchy wiring
    if (!roleToId.has(roleDef.role)) {
      roleToId.set(roleDef.role, agent.id);
    }
  }

  return created;
}

// ── Org tree ─────────────────────────────────────────────────────────────────

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

/**
 * Build org tree from flat agent list.
 */
export async function buildOrgTree(db: Db, tenantId: string): Promise<OrgNode[]> {
  const allAgents = await db.select().from(agents).where(eq(agents.tenantId, tenantId));

  const nodeMap = new Map<string, OrgNode>();
  for (const a of allAgents) {
    nodeMap.set(a.id, { id: a.id, name: a.name, role: a.role, status: a.status, reports: [] });
  }

  const roots: OrgNode[] = [];

  for (const a of allAgents) {
    const node = nodeMap.get(a.id)!;
    if (a.reportsTo && nodeMap.has(a.reportsTo)) {
      nodeMap.get(a.reportsTo)!.reports.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

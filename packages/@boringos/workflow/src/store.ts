import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflows } from "@boringos/db";
import type {
  WorkflowStore,
  WorkflowDefinition,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  BlockDefinition,
  EdgeDefinition,
} from "./types.js";
import { generateId } from "@boringos/shared";

export function createWorkflowStore(db: Db): WorkflowStore {
  function toDefinition(row: typeof workflows.$inferSelect): WorkflowDefinition {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      type: row.type as "user" | "system",
      status: row.status as WorkflowDefinition["status"],
      governingAgentId: row.governingAgentId,
      blocks: (row.blocks ?? []) as unknown as BlockDefinition[],
      edges: (row.edges ?? []) as unknown as EdgeDefinition[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async get(id: string): Promise<WorkflowDefinition | null> {
      const rows = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
      return rows[0] ? toDefinition(rows[0]) : null;
    },

    async list(tenantId: string): Promise<WorkflowDefinition[]> {
      const rows = await db.select().from(workflows).where(eq(workflows.tenantId, tenantId));
      return rows.map(toDefinition);
    },

    async create(input: CreateWorkflowInput): Promise<WorkflowDefinition> {
      const id = generateId();
      const now = new Date();
      await db.insert(workflows).values({
        id,
        tenantId: input.tenantId,
        name: input.name,
        type: input.type ?? "user",
        governingAgentId: input.governingAgentId,
        blocks: (input.blocks ?? []) as unknown as Record<string, unknown>[],
        edges: (input.edges ?? []) as unknown as Record<string, unknown>[],
      });
      const rows = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
      return toDefinition(rows[0]!);
    },

    async update(id: string, input: UpdateWorkflowInput): Promise<WorkflowDefinition> {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) values.name = input.name;
      if (input.status !== undefined) values.status = input.status;
      if (input.governingAgentId !== undefined) values.governingAgentId = input.governingAgentId;
      if (input.blocks !== undefined) values.blocks = input.blocks as unknown as Record<string, unknown>[];
      if (input.edges !== undefined) values.edges = input.edges as unknown as Record<string, unknown>[];

      await db.update(workflows).set(values).where(eq(workflows.id, id));
      const rows = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
      return toDefinition(rows[0]!);
    },

    async delete(id: string): Promise<void> {
      await db.delete(workflows).where(eq(workflows.id, id));
    },
  };
}

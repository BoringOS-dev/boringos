// SPDX-License-Identifier: MIT
//
// N5 — When a connector finishes OAuth, install (or resume) every
// DefaultWorkflowSpec the connector author shipped via
// connector.defaultWorkflows(). Idempotent on the spec.tag stored in
// the workflow's description prefix; safe to call on every reconnect.
//
// Disconnect path lives in disconnectConnectorWorkflows() — pauses the
// routine but keeps the workflow rows so reconnect resumes cleanly
// (N6 spec: "Drop the workflow data on disconnect — preserve unless
// the user explicitly removes").

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { workflows, routines } from "@boringos/db";
import type {
  ConnectorDefinition,
  DefaultWorkflowSpec,
} from "@boringos/connector";
import { generateId } from "@boringos/shared";

const TAG_PREFIX = "[connector-default:";

function tagDescription(tag: string, original?: string): string {
  return `${TAG_PREFIX}${tag}] ${original ?? ""}`.trim();
}

function extractTag(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const m = desc.match(/^\[connector-default:([^\]]+)\]/);
  return m ? m[1] : null;
}

export interface InstallResult {
  installed: number;
  resumed: number;
  skipped: number;
}

export async function installDefaultWorkflows(
  db: Db,
  tenantId: string,
  connector: ConnectorDefinition,
): Promise<InstallResult> {
  if (typeof connector.defaultWorkflows !== "function") {
    return { installed: 0, resumed: 0, skipped: 0 };
  }
  const specs = connector.defaultWorkflows();
  if (specs.length === 0) return { installed: 0, resumed: 0, skipped: 0 };

  let installed = 0;
  let resumed = 0;
  let skipped = 0;

  for (const spec of specs) {
    const existingWorkflowId = await findWorkflowByTag(db, tenantId, spec.tag);

    if (existingWorkflowId) {
      // Reconnect path: ensure routine is unpaused.
      const updated = await db
        .update(routines)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(routines.tenantId, tenantId),
            eq(routines.workflowId, existingWorkflowId),
          ),
        );
      if (updated) resumed++;
      else skipped++;
      continue;
    }

    await createDefaultWorkflowFromSpec(db, tenantId, spec);
    installed++;
  }

  return { installed, resumed, skipped };
}

async function findWorkflowByTag(
  db: Db,
  tenantId: string,
  tag: string,
): Promise<string | null> {
  const rows = await db.select().from(workflows).where(eq(workflows.tenantId, tenantId));
  for (const row of rows) {
    const t = extractTag((row as { name: string }).name);
    if (t === tag) return row.id;
  }
  return null;
}

async function createDefaultWorkflowFromSpec(
  db: Db,
  tenantId: string,
  spec: DefaultWorkflowSpec,
): Promise<string> {
  const workflowId = generateId();
  // We tag the workflow via its name prefix because the workflows table
  // doesn't have a dedicated metadata column. Tag-in-name is ugly but
  // localized — apps don't depend on the exact name for routing.
  const taggedName = `${TAG_PREFIX}${spec.tag}] ${spec.name}`;

  await db.insert(workflows).values({
    id: workflowId,
    tenantId,
    name: taggedName,
    type: "system",
    status: "active",
    blocks: spec.blocks as unknown as Record<string, unknown>[],
    edges: spec.edges as unknown as Record<string, unknown>[],
  });

  if (spec.routine) {
    await db.insert(routines).values({
      id: generateId(),
      tenantId,
      title: spec.routine.title,
      description: tagDescription(spec.tag, spec.routine.title),
      workflowId,
      cronExpression: spec.routine.cronExpression,
      timezone: spec.routine.timezone ?? "UTC",
      status: "active",
    });
  }

  return workflowId;
}

/**
 * Pause the routines for a connector's default workflows on disconnect.
 * Workflow rows + routine rows stay so a future reconnect resumes
 * without losing user-edited fields.
 */
export async function pauseDefaultWorkflows(
  db: Db,
  tenantId: string,
  connectorKind: string,
): Promise<{ paused: number }> {
  const tagPrefix = `${connectorKind}.`;
  const all = await db.select().from(workflows).where(eq(workflows.tenantId, tenantId));
  const myWorkflowIds: string[] = [];
  for (const row of all) {
    const t = extractTag((row as { name: string }).name);
    if (t && t.startsWith(tagPrefix)) {
      myWorkflowIds.push(row.id);
    }
  }
  if (myWorkflowIds.length === 0) return { paused: 0 };

  let paused = 0;
  for (const workflowId of myWorkflowIds) {
    await db
      .update(routines)
      .set({ status: "paused", updatedAt: new Date() })
      .where(
        and(
          eq(routines.tenantId, tenantId),
          eq(routines.workflowId, workflowId),
        ),
      );
    paused++;
  }
  return { paused };
}

/** Internal helper exposed for tests. */
export const __test = { TAG_PREFIX, extractTag, tagDescription };
// Quiet the unused-import linter for sql when neither path runs.
void sql;

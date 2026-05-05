// SPDX-License-Identifier: BUSL-1.1
//
// K4 — workflow template registration runner.
//
// Reads `AppDefinition.workflows` and inserts one `workflows` row per
// template inside the install transaction. Cron triggers also produce a
// matching `routines` row so the framework's existing scheduler picks
// them up. Event / webhook triggers are encoded inside the workflow's
// `blocks` (the dispatcher reads `type=trigger` blocks at boot), so no
// extra row is needed for them.
//
// Re-install replaces by app id: delete the prior workflow + routine
// set for this app, then insert the new set.

import { sql } from "drizzle-orm";

import type { AppDefinition, WorkflowTemplate } from "@boringos/app-sdk";

import type { DrizzleTx } from "./drizzle-install-db.js";

export interface WorkflowTriggerSpec {
  type: "event" | "cron" | "webhook";
  /** Event type for `event` triggers (e.g. "inbox.item_created"). */
  event?: string;
  /** Cron expression for `cron` triggers (5-field). */
  cron?: string;
  /** Optional timezone for cron triggers. Default UTC. */
  timezone?: string;
  /** Webhook path for `webhook` triggers (advisory). */
  path?: string;
}

export interface RegisterAppWorkflowsArgs {
  tenantId: string;
  appId: string;
  templates: WorkflowTemplate[];
}

export interface RegisteredWorkflow {
  id: string;
  appWorkflowDefId: string;
  name: string;
  routineIds: string[];
}

export interface RegisterAppWorkflowsResult {
  inserted: RegisteredWorkflow[];
  removedWorkflows: number;
  removedRoutines: number;
}

export async function registerAppWorkflows(
  tx: DrizzleTx,
  args: RegisterAppWorkflowsArgs,
): Promise<RegisterAppWorkflowsResult> {
  const { tenantId, appId, templates } = args;

  // 1. Wipe routines that point at any prior workflow for this app.
  const removedRoutines = (await tx.execute(sql`
    DELETE FROM routines
    WHERE tenant_id = ${tenantId}
      AND workflow_id IN (
        SELECT id FROM workflows
        WHERE tenant_id = ${tenantId}
          AND metadata @> ${JSON.stringify({ appId })}::jsonb
      )
    RETURNING id
  `)) as Array<{ id: string }>;

  // 2. Wipe prior workflows.
  const removedWorkflows = (await tx.execute(sql`
    DELETE FROM workflows
    WHERE tenant_id = ${tenantId}
      AND metadata @> ${JSON.stringify({ appId })}::jsonb
    RETURNING id
  `)) as Array<{ id: string }>;

  if (templates.length === 0) {
    return {
      inserted: [],
      removedWorkflows: removedWorkflows.length,
      removedRoutines: removedRoutines.length,
    };
  }

  const inserted: RegisteredWorkflow[] = [];

  for (const template of templates) {
    if (!template.id || !template.name) {
      throw new WorkflowRegistrarError(
        `Workflow template for app "${appId}" missing id or name`,
      );
    }

    const blocks = Array.isArray(template.blocks) ? template.blocks : [];
    const edges = Array.isArray(template.edges) ? template.edges : [];
    const metadata = {
      appId,
      appWorkflowDefId: template.id,
    };

    const wfRows = (await tx.execute(sql`
      INSERT INTO workflows (
        tenant_id, name, type, status, blocks, edges, metadata
      )
      VALUES (
        ${tenantId},
        ${template.name},
        ${'system'},
        ${'active'},
        ${JSON.stringify(blocks)}::jsonb,
        ${JSON.stringify(edges)}::jsonb,
        ${JSON.stringify(metadata)}::jsonb
      )
      RETURNING id
    `)) as Array<{ id: string }>;
    const workflowId = wfRows[0]?.id;
    if (!workflowId) {
      throw new WorkflowRegistrarError(
        `Insert for workflow "${template.id}" did not return an id`,
      );
    }

    const triggersRaw = (template as { triggers?: unknown }).triggers;
    const triggers: WorkflowTriggerSpec[] = Array.isArray(triggersRaw)
      ? (triggersRaw as WorkflowTriggerSpec[])
      : [];

    const routineIds: string[] = [];
    for (const trig of triggers) {
      if (trig.type !== "cron" || !trig.cron) continue;
      const routineRows = (await tx.execute(sql`
        INSERT INTO routines (
          tenant_id, title, workflow_id, cron_expression, timezone, status
        )
        VALUES (
          ${tenantId},
          ${template.name},
          ${workflowId},
          ${trig.cron},
          ${trig.timezone ?? "UTC"},
          ${'active'}
        )
        RETURNING id
      `)) as Array<{ id: string }>;
      const rid = routineRows[0]?.id;
      if (rid) routineIds.push(rid);
    }

    inserted.push({
      id: workflowId,
      appWorkflowDefId: template.id,
      name: template.name,
      routineIds,
    });
  }

  return {
    inserted,
    removedWorkflows: removedWorkflows.length,
    removedRoutines: removedRoutines.length,
  };
}

export async function registerWorkflowsFromDefinition(
  tx: DrizzleTx,
  tenantId: string,
  appId: string,
  definition: AppDefinition,
): Promise<RegisterAppWorkflowsResult> {
  return registerAppWorkflows(tx, {
    tenantId,
    appId,
    templates: definition.workflows ?? [],
  });
}

export class WorkflowRegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRegistrarError";
  }
}

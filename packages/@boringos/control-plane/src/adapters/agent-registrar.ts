// SPDX-License-Identifier: BUSL-1.1
//
// K3 — agent registration runner.
//
// Reads `AppDefinition.agents` and writes one row per agent into the
// framework's `agents` table inside the install transaction. Each row
// is tagged with `metadata.appId` (and `metadata.appAgentDefId`) so a
// re-install can identify the prior set and replace it idempotently.
//
// Out of scope: waking the agents — that is a per-trigger concern.
// We only land the registration row.

import { sql } from "drizzle-orm";

import type { AppDefinition, AgentDefinition } from "@boringos/app-sdk";

import type { DrizzleTx } from "./drizzle-install-db.js";

export interface RegisterAppAgentsArgs {
  tenantId: string;
  appId: string;
  agents: AgentDefinition[];
}

export interface RegisteredAgent {
  id: string;
  appAgentDefId: string;
  name: string;
}

export interface RegisterAppAgentsResult {
  inserted: RegisteredAgent[];
  removed: number;
}

/**
 * Idempotently register an app's agents inside an install transaction.
 *
 * Strategy: delete every prior row with `metadata.appId = <appId>` for
 * this tenant, then insert the current definition set. This is the
 * "delete-by-app-id then re-insert" pattern from the K3 spec.
 *
 * The pre-delete uses a `(tenant_id, app_id) → metadata->>appId` jsonb
 * filter so prior rows planted by an earlier install are wiped before
 * the new set lands.
 *
 * Note on referential cleanup: this function only deletes rows in the
 * `agents` table. Dependent rows (agent_runs, agent_wakeup_requests,
 * etc.) are out of scope; if a real re-install is triggered against an
 * agent with run history, callers should soft-replace via the uninstall
 * pipeline first. v1 install/re-install assumes a clean app slate.
 */
export async function registerAppAgents(
  tx: DrizzleTx,
  args: RegisterAppAgentsArgs,
): Promise<RegisterAppAgentsResult> {
  const { tenantId, appId, agents } = args;

  // Wipe prior registrations for this app.
  const deleted = (await tx.execute(sql`
    DELETE FROM agents
    WHERE tenant_id = ${tenantId}
      AND metadata @> ${JSON.stringify({ appId })}::jsonb
    RETURNING id
  `)) as Array<{ id: string }>;

  if (agents.length === 0) {
    return { inserted: [], removed: deleted.length };
  }

  const inserted: RegisteredAgent[] = [];

  for (const def of agents) {
    if (!def.id) {
      throw new AgentRegistrarError(
        `Agent definition for app "${appId}" missing required \`id\``,
      );
    }
    if (!def.name) {
      throw new AgentRegistrarError(
        `Agent definition "${def.id}" for app "${appId}" missing \`name\``,
      );
    }

    const persona = typeof def.persona === "string" ? def.persona : null;
    const role = persona ?? "general";
    const instructions =
      typeof def.instructions === "string" ? def.instructions : null;
    const runtime = typeof def.runtime === "string" ? def.runtime : null;
    const skills = Array.isArray(def.skills)
      ? def.skills.filter((s): s is string => typeof s === "string")
      : [];

    const metadata = {
      appId,
      appAgentDefId: def.id,
      runtimeKind: runtime,
      persona,
    };

    // Resolve runtime_id by looking up the tenant's runtime row whose
    // `type` matches def.runtime (or "claude" as the default for app
    // agents that don't pin a runtime). Without this, the agent engine
    // spawns the bare CLI with no --model flag and the local CLI's
    // default model wins (often Opus). Tenant runtimes are seeded by
    // signup (auth-routes.ts), so by the time we install apps every
    // tenant has at least { claude, chatgpt, gemini, ollama, command,
    // webhook }.
    const runtimeKind = runtime ?? "claude";
    const runtimeRows = (await tx.execute(sql`
      SELECT id FROM runtimes
       WHERE tenant_id = ${tenantId} AND type = ${runtimeKind}
       LIMIT 1
    `)) as Array<{ id: string }>;
    const runtimeId = runtimeRows[0]?.id ?? null;

    const rows = (await tx.execute(sql`
      INSERT INTO agents (
        tenant_id, name, role, instructions, skills, metadata, runtime_id
      )
      VALUES (
        ${tenantId},
        ${def.name},
        ${role},
        ${instructions},
        ${JSON.stringify(skills)}::jsonb,
        ${JSON.stringify(metadata)}::jsonb,
        ${runtimeId}
      )
      RETURNING id
    `)) as Array<{ id: string }>;

    const id = rows[0]?.id;
    if (!id) {
      throw new AgentRegistrarError(
        `Insert for agent "${def.id}" did not return an id`,
      );
    }

    inserted.push({ id, appAgentDefId: def.id, name: def.name });
  }

  return { inserted, removed: deleted.length };
}

/**
 * Convenience wrapper that pulls the agent list off an AppDefinition.
 * Lets the kernel install context call `registerAgentsFromDefinition`
 * without unpacking each time.
 */
export async function registerAgentsFromDefinition(
  tx: DrizzleTx,
  tenantId: string,
  appId: string,
  definition: AppDefinition,
): Promise<RegisterAppAgentsResult> {
  return registerAppAgents(tx, {
    tenantId,
    appId,
    agents: definition.agents ?? [],
  });
}

export class AgentRegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistrarError";
  }
}

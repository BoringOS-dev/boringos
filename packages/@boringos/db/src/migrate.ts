import { sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import type { MigrationManager, MigrationInfo, MigrationResult } from "./types.js";
import { FRAMEWORK_TABLES } from "./types.js";

export function createMigrationManager(db: Db): MigrationManager {
  return {
    async pending(): Promise<MigrationInfo[]> {
      return FRAMEWORK_TABLES.map((name) => ({ name, appliedAt: null }));
    },

    async apply(): Promise<MigrationResult> {
      await ensureSchema(db);
      return { applied: [...FRAMEWORK_TABLES], skipped: [] };
    },

    async status(): Promise<MigrationInfo[]> {
      return FRAMEWORK_TABLES.map((name) => ({ name, appliedAt: new Date() }));
    },
  };
}

async function ensureSchema(db: Db): Promise<void> {
  // Create all framework tables using raw SQL DDL.
  // This is the bootstrap path — creates tables if they don't exist.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tenant_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS runtimes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      model TEXT,
      status TEXT NOT NULL DEFAULT 'unchecked',
      health_result JSONB,
      last_checked_at TIMESTAMPTZ,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'general',
      type TEXT NOT NULL DEFAULT 'user',
      title TEXT,
      icon TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      reports_to UUID REFERENCES agents(id),
      instructions TEXT,
      runtime_id UUID REFERENCES runtimes(id) ON DELETE SET NULL,
      fallback_runtime_id UUID REFERENCES runtimes(id) ON DELETE SET NULL,
      budget_monthly_cents INTEGER NOT NULL DEFAULT 0,
      spent_monthly_cents INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT,
      paused_at TIMESTAMPTZ,
      permissions JSONB NOT NULL DEFAULT '{}',
      last_heartbeat_at TIMESTAMPTZ,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_runtime_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL UNIQUE REFERENCES agents(id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      session_id TEXT,
      state_json JSONB,
      cumulative_input_tokens INTEGER NOT NULL DEFAULT 0,
      cumulative_output_tokens INTEGER NOT NULL DEFAULT 0,
      cumulative_cost_usd TEXT NOT NULL DEFAULT '0',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      parent_id UUID REFERENCES tasks(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      assignee_user_id UUID,
      created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_by_user_id UUID,
      issue_number INTEGER,
      identifier TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_id TEXT,
      request_depth INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      body TEXT NOT NULL,
      author_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      author_user_id UUID,
      mentions JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_work_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      metadata JSONB,
      created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_wakeup_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      task_id UUID,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      coalesced_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      wakeup_request_id UUID REFERENCES agent_wakeup_requests(id),
      status TEXT NOT NULL DEFAULT 'queued',
      exit_code INTEGER,
      error TEXT,
      error_code TEXT,
      stdout_excerpt TEXT,
      stderr_excerpt TEXT,
      usage_json JSONB,
      context_snapshot JSONB,
      session_id_before TEXT,
      session_id_after TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cost_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      run_id UUID REFERENCES agent_runs(id),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cost_usd TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      type TEXT NOT NULL,
      requested_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      requested_by_user_id UUID,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}',
      decision_note TEXT,
      decided_by_user_id UUID,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id),
      approval_id UUID NOT NULL REFERENCES approvals(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS connectors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config JSONB NOT NULL DEFAULT '{}',
      credentials JSONB,
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS company_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL,
      source_config JSONB NOT NULL DEFAULT '{}',
      trust_level TEXT NOT NULL DEFAULT 'markdown_only',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      last_sync_at TIMESTAMPTZ,
      file_inventory JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id),
      skill_id UUID NOT NULL REFERENCES company_skills(id),
      state TEXT NOT NULL DEFAULT 'active',
      sync_mode TEXT NOT NULL DEFAULT 'auto',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS drive_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      format TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      hash TEXT,
      synced_to_memory BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'draft',
      governing_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      blocks JSONB NOT NULL DEFAULT '[]',
      edges JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      actor_type TEXT,
      actor_id UUID,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS agents_tenant_status_idx ON agents(tenant_id, status);
    CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks(tenant_id, status);
    CREATE INDEX IF NOT EXISTS tasks_assignee_agent_idx ON tasks(assignee_agent_id);
    CREATE INDEX IF NOT EXISTS agent_runs_tenant_agent_idx ON agent_runs(tenant_id, agent_id);
  `);
}

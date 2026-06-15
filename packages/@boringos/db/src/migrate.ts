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
      // Brain vector tier is applied separately + defensively: the
      // embedded Postgres distro ships pg_trgm but NOT pgvector
      // (decision #2 in docs/brain.md). A failed `CREATE EXTENSION
      // vector` must not abort the whole migration, so it runs in
      // its own execute() outside the big multi-statement block.
      await ensureBrainVectorTier(db);
      return { applied: [...FRAMEWORK_TABLES], skipped: [] };
    },

    async status(): Promise<MigrationInfo[]> {
      return FRAMEWORK_TABLES.map((name) => ({ name, appliedAt: new Date() }));
    },
  };
}

async function ensureSchema(db: Db): Promise<void> {
  // Serialize concurrent migration runs across processes sharing the same DB.
  // The lock id is a stable hash of "boringos-migrate" (arbitrary but fixed).
  await db.execute(sql`SELECT pg_advisory_lock(727363677)`);
  try {
    await _applySchema(db);
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(727363677)`);
  }
}

async function _applySchema(db: Db): Promise<void> {
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

    -- runtimes table: VESTIGIAL backward-compat shim. The framework no
    -- longer reads or writes it -- runtime is host-wide via BORINGOS_RUNTIME,
    -- resolved by the engine at wake time (no drizzle schema, no API, no UI,
    -- no agents.runtime_id). It is kept (empty) ONLY so already-published
    -- third-party .hebbsmod packages that still SELECT from runtimes in
    -- their install hooks degrade gracefully (empty result hits their own
    -- "no runtime, skip" branch) instead of hard-erroring on a missing
    -- relation. New modules must not depend on it; a future major may drop it.
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

    -- agent_runtime_state removed: sessions are now task-scoped via
    -- tasks.session_id (one session per task, not per agent).

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
      proposed_params JSONB,
      metadata JSONB,
      session_id TEXT,
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
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cost_usd TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0;

    -- approvals + task_approvals removed: approvals are now tasks
    -- (origin_kind="agent_action") with metadata.approval. See
    -- docs/blockers/done/task_06_collapse_approvals_into_tasks.md.

    -- Task 2.11: drop the legacy connectors table. All credential storage
    -- has moved to connector_accounts (multi-account, AES-256-GCM TEXT creds).
    -- CASCADE handles any orphaned foreign keys (none expected in practice).
    DROP TABLE IF EXISTS connectors CASCADE;

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

    -- One row per (tenant, path). Pre-existing dbs without the
    -- constraint may hold duplicate rows from older code paths;
    -- the dedupe DELETE keeps the most-recent entry per path
    -- before adding the index.
    DELETE FROM drive_files
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY tenant_id, path
                  ORDER BY updated_at DESC, created_at DESC
                ) AS rn
           FROM drive_files
       ) t WHERE t.rn > 1
     );

    CREATE UNIQUE INDEX IF NOT EXISTS drive_files_tenant_path_uniq
      ON drive_files(tenant_id, path);

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

    CREATE TABLE IF NOT EXISTS budget_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'tenant',
      period TEXT NOT NULL DEFAULT 'monthly',
      limit_cents INTEGER NOT NULL,
      warn_threshold_pct INTEGER NOT NULL DEFAULT 80,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS budget_incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      policy_id UUID NOT NULL REFERENCES budget_policies(id),
      agent_id UUID REFERENCES agents(id),
      type TEXT NOT NULL,
      spent_cents INTEGER NOT NULL,
      limit_cents INTEGER NOT NULL,
      run_id UUID,
      dismissed TEXT DEFAULT 'false',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS routines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      description TEXT,
      assignee_agent_id UUID REFERENCES agents(id),
      workflow_id UUID REFERENCES workflows(id),
      cron_expression TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'active',
      concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
      last_triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugin_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      plugin_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS plugin_job_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      plugin_name TEXT NOT NULL,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      prefix TEXT,
      next_issue_number TEXT NOT NULL DEFAULT '1',
      repo_url TEXT,
      default_branch TEXT DEFAULT 'main',
      branch_template TEXT DEFAULT 'bos/{{identifier}}-{{slug}}',
      settings JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS goals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      color TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS task_read_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS drive_skill_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      content TEXT NOT NULL,
      changed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS onboarding_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) UNIQUE,
      current_step INTEGER NOT NULL DEFAULT 1,
      total_steps INTEGER NOT NULL DEFAULT 5,
      completed_steps JSONB NOT NULL DEFAULT '[]',
      metadata JSONB NOT NULL DEFAULT '{}',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cli_auth_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_code TEXT NOT NULL UNIQUE,
      user_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      session_token TEXT,
      user_id TEXT,
      tenant_id UUID,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS evals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      description TEXT,
      test_cases JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      eval_id UUID NOT NULL REFERENCES evals(id),
      agent_id UUID NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'running',
      total_cases INTEGER NOT NULL DEFAULT 0,
      passed_cases INTEGER NOT NULL DEFAULT 0,
      failed_cases INTEGER NOT NULL DEFAULT 0,
      results JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS inbox_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      assignee_user_id TEXT,
      source TEXT NOT NULL,
      source_id TEXT,
      subject TEXT NOT NULL,
      body TEXT,
      "from" TEXT,
      status TEXT NOT NULL DEFAULT 'unread',
      metadata JSONB,
      linked_task_id UUID,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS entity_references (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS entity_refs_entity_idx ON entity_references(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS entity_refs_ref_idx ON entity_references(ref_type, ref_id);

    -- Add columns to tasks if they don't exist
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_id UUID;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkout_run_id UUID;
    -- Pre-filled payload for agent_action tasks (Actions queue)
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proposed_params JSONB;
    -- Open-ended metadata jsonb. Stamps the approval decision on
    -- agent_action tasks. See task_06 in docs/blockers/done.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB;
    -- Runtime that created tasks.session_id. Sessions are runtime-specific;
    -- the engine only resumes when this matches the agent's current runtime
    -- (NULL ⇒ legacy "claude"). See docs/pi-runtime-integration.md.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_runtime_type TEXT;
    -- Index for the Actions queue: filter by assignee + status + origin_kind
    CREATE INDEX IF NOT EXISTS tasks_actions_idx ON tasks(tenant_id, assignee_user_id, status, origin_kind);

    -- Workflow execution history (Phase 1 of the workflow UI roadmap)
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      workflow_id UUID NOT NULL REFERENCES workflows(id),
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      trigger_payload JSONB,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS workflow_runs_workflow_started_idx ON workflow_runs(workflow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS workflow_runs_tenant_started_idx ON workflow_runs(tenant_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_block_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      block_id TEXT NOT NULL,
      block_name TEXT NOT NULL,
      block_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_config JSONB,
      input_context JSONB,
      output JSONB,
      selected_handle TEXT,
      error TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS workflow_block_runs_run_idx ON workflow_block_runs(workflow_run_id);

    -- Phase 3: wait-for-human resume support
    ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS paused_at_block_id TEXT;
    ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS awaiting_action_task_id UUID;

    -- Add assignee_user_id to inbox_items if it doesn't exist (for existing DBs)
    ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS assignee_user_id TEXT;

    -- Snooze: wall-clock when the framework should flip the row back to unread
    ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS inbox_items_snooze_until_idx
      ON inbox_items (snooze_until)
      WHERE status = 'snoozed';

    -- Add model column to agent_runs for tracking which model was used
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model TEXT;

    -- Per-agent model override. When set, takes priority over the host
    -- runtime's default model at execution time. Lets the operator pick
    -- Sonnet vs Opus vs Haiku (or the host runtime's equivalents) per
    -- agent. The engine passes it as the runtime's --model.
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS model TEXT;

    -- Drop the deprecated per-agent runtime binding. Runtime is host-wide
    -- via BORINGOS_RUNTIME; the engine never reads these columns. Idempotent.
    -- (The runtimes table itself is kept as an empty compat shim — see above.)
    ALTER TABLE agents DROP COLUMN IF EXISTS runtime_id;
    ALTER TABLE agents DROP COLUMN IF EXISTS fallback_runtime_id;

    -- Routing tags column on agents (used by the delegation router for
    -- keyword matching). Originally named "skills" — task_15 §1 renamed
    -- it to disambiguate from prompt skills (modules + company_skills).
    -- This migration is idempotent and handles the transition: add the
    -- new column, backfill from the old one if present, then drop it.
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS routing_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
    DO $$ BEGIN
      UPDATE agents SET routing_tags = skills WHERE routing_tags = '[]'::jsonb;
      ALTER TABLE agents DROP COLUMN skills;
    EXCEPTION WHEN undefined_column THEN NULL; END $$;

    -- Task 07: Agent provenance tracking — distinguish shell/user/app agents
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS source_app_id TEXT;
    -- Idempotent CHECK adds: Postgres has no ADD CONSTRAINT IF NOT EXISTS,
    -- so swallow the duplicate-object error if the constraint exists
    -- already from a prior run.
    DO $$ BEGIN
      ALTER TABLE agents ADD CONSTRAINT agents_source_check CHECK (source IN ('shell', 'user', 'app'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE agents ADD CONSTRAINT agents_source_app_id_check CHECK ((source = 'app') = (source_app_id IS NOT NULL));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Task 07: Tenant root agent pointer — every tenant has exactly one CoS at reports_to IS NULL
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS root_agent_id UUID REFERENCES agents(id);

    -- Backfill: tenants that already have multiple root agents
    -- (existed before this constraint landed) get their extra roots
    -- reparented under the oldest root, so the unique index below
    -- can succeed. Without this, any tenant whose Copilot + default
    -- apps were all installed as roots blocks the migration.
    WITH oldest_root AS (
      SELECT DISTINCT ON (tenant_id) tenant_id, id AS root_id
        FROM agents
       WHERE reports_to IS NULL
       ORDER BY tenant_id, created_at ASC
    )
    UPDATE agents SET reports_to = oldest_root.root_id
      FROM oldest_root
     WHERE agents.tenant_id = oldest_root.tenant_id
       AND agents.reports_to IS NULL
       AND agents.id <> oldest_root.root_id;

    CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_one_root_idx ON agents(tenant_id) WHERE reports_to IS NULL;

    -- Invitations for multi-tenant team management
    CREATE TABLE IF NOT EXISTS invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS agents_tenant_status_idx ON agents(tenant_id, status);
    CREATE INDEX IF NOT EXISTS agents_tenant_source_idx ON agents(tenant_id, source);
    CREATE INDEX IF NOT EXISTS agents_tenant_source_app_idx ON agents(tenant_id, source_app_id);
    CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks(tenant_id, status);
    CREATE INDEX IF NOT EXISTS tasks_assignee_agent_idx ON tasks(assignee_agent_id);
    CREATE INDEX IF NOT EXISTS agent_runs_tenant_agent_idx ON agent_runs(tenant_id, agent_id);

    -- Handoff state machine. Independent of the status column (lifecycle).
    -- 'agent' = agent should pick up; 'human' = waiting on human; NULL = terminal.
    -- Keep the legacy status column untouched so every consumer that
    -- reads it keeps working; the new behavior keys off next_actor only.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_actor TEXT;
    UPDATE tasks SET next_actor = CASE
      WHEN status = 'done' THEN NULL
      WHEN status = 'cancelled' THEN NULL
      WHEN assignee_agent_id IS NOT NULL THEN 'agent'
      ELSE 'human'
    END WHERE next_actor IS NULL;
    CREATE INDEX IF NOT EXISTS tasks_next_actor_idx ON tasks(tenant_id, next_actor) WHERE next_actor IS NOT NULL;

    -- Auto-set next_actor on insert if caller didn't specify one.
    -- This means every existing INSERT path keeps working — no need
    -- to touch admin-routes, copilot module, framework.tasks.create,
    -- inbox-fanout, etc. The trigger derives next_actor from the
    -- assignee at insert time. Status='done'/'cancelled' clear it
    -- back to NULL on update.
    CREATE OR REPLACE FUNCTION tasks_set_next_actor() RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' AND NEW.next_actor IS NULL THEN
        NEW.next_actor := CASE
          WHEN NEW.status IN ('done', 'cancelled') THEN NULL
          WHEN NEW.assignee_agent_id IS NOT NULL THEN 'agent'
          ELSE 'human'
        END;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.status IN ('done', 'cancelled') AND OLD.status NOT IN ('done', 'cancelled') THEN
        NEW.next_actor := NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS tasks_set_next_actor_trigger ON tasks;
    CREATE TRIGGER tasks_set_next_actor_trigger
      BEFORE INSERT OR UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION tasks_set_next_actor();

    -- Workflow metadata column (kept).
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS metadata JSONB;

    -- Legacy install tables (tenant_apps, tenant_app_links) dropped.
    -- Single Module install pipeline lives in module_installs below.
    DROP TABLE IF EXISTS tenant_app_links;
    DROP TABLE IF EXISTS tenant_apps;

    -- Module-system audited tool dispatcher.
    CREATE TABLE IF NOT EXISTS tool_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      module_id TEXT NOT NULL,
      invoked_by TEXT NOT NULL,
      agent_id UUID,
      run_id UUID,
      task_id UUID,
      inputs JSONB,
      result JSONB,
      error JSONB,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      idempotency_key TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS tool_calls_tenant_tool_idx
      ON tool_calls(tenant_id, tool_name);
    CREATE INDEX IF NOT EXISTS tool_calls_tenant_started_idx
      ON tool_calls(tenant_id, started_at);
    CREATE INDEX IF NOT EXISTS tool_calls_run_idx
      ON tool_calls(run_id);

    -- Legacy hebbs_crm__* tables dropped — the lightweight built-in
    -- hebbs-crm module was removed. The real CRM lives in the
    -- separate boringos-crm repo and owns crm__* tables which are
    -- created on install via its own Module migrations.
    DROP TABLE IF EXISTS hebbs_crm__activities CASCADE;
    DROP TABLE IF EXISTS hebbs_crm__deals CASCADE;
    DROP TABLE IF EXISTS hebbs_crm__contacts CASCADE;
    DROP TABLE IF EXISTS hebbs_crm__pipelines CASCADE;

    -- module install state. One row per (tenant, module). The
    -- framework registry knows which modules the host has imported;
    -- this table records which of those a given tenant has actually
    -- installed (via the admin UI or auto-install at signup).
    -- Phase 9 of task_12.
    CREATE TABLE IF NOT EXISTS module_installs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      version TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS module_installs_tenant_module_idx
      ON module_installs(tenant_id, module_id);

    -- module-shipped schema migrations applied per-tenant.
    -- Tracks which Module.schema[].id has been applied for which
    -- (tenant, module). Enables idempotent re-install + clean
    -- rollback at uninstall. Chunk C of the final session.
    CREATE TABLE IF NOT EXISTS module_migrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS module_migrations_uniq_idx
      ON module_migrations(tenant_id, module_id, migration_id);

    -- LAYER-1 (host-global) record of every uploaded .hebbsmod package.
    -- One row per (module_id, version) uploaded to this host. Distinct
    -- from module_installs (per-tenant opt-in). task_22 — module
    -- package upload / install flow.
    CREATE TABLE IF NOT EXISTS module_packages (
      id TEXT NOT NULL,
      version TEXT NOT NULL,
      kind TEXT NOT NULL,
      store_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      signature_publisher_id TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, version)
    );
    CREATE INDEX IF NOT EXISTS module_packages_content_hash_idx
      ON module_packages(content_hash);

    -- Audit log for every OAuth token brokered through getConnectorToken.
    -- Fire-and-forget write by the connector-token dispatcher. Never
    -- stores the token itself — only who asked, for which provider, when,
    -- and what the outcome was. Lets operators answer "which module is
    -- hitting Google hardest" / "did this incident come from EA's
    -- calendar sync" without log-trawling.
    CREATE TABLE IF NOT EXISTS connector_token_issuance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      caller_module_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS token_issuance_tenant_kind_idx
      ON connector_token_issuance(tenant_id, kind, issued_at);
    CREATE INDEX IF NOT EXISTS token_issuance_caller_idx
      ON connector_token_issuance(tenant_id, caller_module_id, issued_at);

    -- Task 2.1: v2 connector model -- multi-account, OAuth app overrides, module bindings.
    --
    -- connector_accounts: replaces the single-account-per-provider model of the
    -- legacy connectors table. credentials is TEXT (AES-256-GCM ciphertext string)
    -- rather than JSONB so the encrypted value round-trips without casts.
    CREATE TABLE IF NOT EXISTS connector_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      auth_strategy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credentials TEXT NOT NULL,
      granted_scopes JSONB NOT NULL DEFAULT '[]',
      profile JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, provider, account_id)
    );
    CREATE INDEX IF NOT EXISTS connector_accounts_tenant_provider_idx
      ON connector_accounts(tenant_id, provider);

    -- connector_oauth_apps: per-tenant "bring your own OAuth app" credentials.
    -- Stored encrypted (TEXT). One override per (tenant, provider).
    CREATE TABLE IF NOT EXISTS connector_oauth_apps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      provider TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, provider)
    );

    -- module_connector_bindings: records which connector account a module uses when
    -- the tenant has multiple accounts for the same provider. Falls back to the most
    -- recent active account when no binding is present.
    CREATE TABLE IF NOT EXISTS module_connector_bindings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      module_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, module_id, provider)
    );
    CREATE INDEX IF NOT EXISTS module_bindings_tenant_module_idx
      ON module_connector_bindings(tenant_id, module_id);

    -- Augment connector_token_issuance with v2 fields. Nullable so legacy rows
    -- written by the v1 dispatcher are unaffected. New rows from AuthManager will
    -- populate both columns.
    ALTER TABLE connector_token_issuance ADD COLUMN IF NOT EXISTS provider TEXT;
    ALTER TABLE connector_token_issuance ADD COLUMN IF NOT EXISTS account_id TEXT;
    -- Backfill provider from the legacy kind column so audit queries
    -- filtering by provider see historical rows. Idempotent: only fills
    -- where provider is still NULL.
    UPDATE connector_token_issuance SET provider = kind WHERE provider IS NULL AND kind IS NOT NULL;

    -- MDK T7.2 -- per-tenant seed tracking. One row per (tenant, module,
    -- kind, seedId) the framework or Lifecycle.seed has seeded. The
    -- baseline_hash column is the canonical JSON hash of the seed
    -- payload at install time; on upgrade we compare the current
    -- row hash to detect tenant edits (modified_since_install).
    -- target_id points at the row in agents/workflows/routines so
    -- re-seeds can update or skip without redoing the lookup.
    CREATE TABLE IF NOT EXISTS __seed_meta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('agent', 'workflow', 'routine')),
      seed_id TEXT NOT NULL,
      target_id UUID NOT NULL,
      baseline_hash TEXT NOT NULL,
      module_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS __seed_meta_uniq_idx
      ON __seed_meta(tenant_id, module_id, kind, seed_id);
    CREATE INDEX IF NOT EXISTS __seed_meta_target_idx
      ON __seed_meta(target_id);

    -- ════════════════════════════════════════════════════════════════
    -- BRAIN — foundation-brain retrieval substrate (docs/brain.md §6).
    --
    -- These cross-cutting brain__* tables ship in the GLOBAL migrator
    -- (decision #7), applied once per host — NOT via Module.schema
    -- (which runs per-tenant and would re-run the DDL for every
    -- install). Every row carries tenant_id from day one so the RLS
    -- deferral (decision #9) never becomes a migration.
    --
    -- The embedding vector(768) column + its HNSW index are NOT
    -- created here: the embedded Postgres distro has no pgvector, so
    -- the vector type doesn't exist at this point. They're added
    -- defensively in ensureBrainVectorTier() AFTER a successful
    -- CREATE EXTENSION vector. Without pgvector the brain runs on
    -- the FTS floor (decision #2) — these tables + the tsvector
    -- column are all it needs to answer.
    -- ════════════════════════════════════════════════════════════════

    -- semantic + files tiers (§4.2, §4.4)
    CREATE TABLE IF NOT EXISTS brain__memories (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID NOT NULL REFERENCES tenants(id),
      entity_id    TEXT,                       -- optional subject (agent, contact, deal)
      source_kind  TEXT NOT NULL,              -- 'file'|'row'|'comment'|'run'|'manual'|'distilled'
      source_ref   TEXT,                       -- drive path / '<table>:<id>' pointer / run id
      chunk_index  INTEGER NOT NULL DEFAULT 0, -- ordering within a chunked source (§4.2)
      kind         TEXT NOT NULL DEFAULT 'note',
      content      TEXT NOT NULL,
      embed_model  TEXT,                       -- model id per row; drift -> lazy re-embed (same dim)
      fts          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      importance   REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0, -- recall hits + distillation dedup (§4.2)
      scope        TEXT NOT NULL DEFAULT 'tenant', -- 'tenant' | 'user'
      owner_user_id TEXT,                       -- set when scope='user'
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at   TIMESTAMPTZ                 -- soft-delete; file deletes land here
    );
    CREATE INDEX IF NOT EXISTS brain__memories_fts_idx
      ON brain__memories USING gin (fts);
    CREATE INDEX IF NOT EXISTS brain__memories_tenant_idx
      ON brain__memories (tenant_id, deleted_at);
    CREATE INDEX IF NOT EXISTS brain__memories_source_idx
      ON brain__memories (tenant_id, source_ref); -- replace-on-reindex

    -- graph tier — typed, directed, provenance-tracked, upsert-keyed (§4.3)
    CREATE TABLE IF NOT EXISTS brain__edges (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id  UUID NOT NULL REFERENCES tenants(id),
      src_type   TEXT NOT NULL,
      src_id     TEXT NOT NULL,
      edge_type  TEXT NOT NULL,                -- 'works_at','invested_in','owns_deal','mentions',...
      dst_type   TEXT NOT NULL,
      dst_id     TEXT NOT NULL,
      weight     REAL NOT NULL DEFAULT 1.0,
      source_ref TEXT,                         -- memory/file that asserted this edge
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ                   -- lifecycle follows the asserting source (§4.3)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS brain__edges_key ON brain__edges
      (tenant_id, src_type, src_id, edge_type, dst_type, dst_id);
    CREATE INDEX IF NOT EXISTS brain__edges_dst_idx
      ON brain__edges (tenant_id, dst_type, dst_id);   -- reverse lookup
    CREATE INDEX IF NOT EXISTS brain__edges_type_idx
      ON brain__edges (tenant_id, edge_type);

    -- entity name registry — mention-matching runs against this (§4.3)
    CREATE TABLE IF NOT EXISTS brain__entities (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id),
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      aliases     TEXT[] NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, entity_type, entity_id)
    );
    -- NOTE: the gin_trgm_ops name index needs pg_trgm installed FIRST,
    -- so it's created in ensureBrainVectorTier() (defensive) — not here.
    -- A plain btree fallback keeps exact-name lookups fast meanwhile.
    CREATE INDEX IF NOT EXISTS brain__entities_name_btree_idx
      ON brain__entities (tenant_id, name);

    -- access tokens (controls — §8)
    CREATE TABLE IF NOT EXISTS brain__access_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id),
      name        TEXT NOT NULL,
      token_hash  TEXT NOT NULL,               -- store hash, never the token
      profile     JSONB NOT NULL,              -- connection profile (allowlist, scopes, gates, budget)
      expires_at  TIMESTAMPTZ,
      revoked_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS brain__access_tokens_tenant_idx
      ON brain__access_tokens (tenant_id);
  `);
}

/**
 * Brain vector tier (docs/brain.md §2, §9). Applied AFTER the main
 * schema, in its own execute() calls so a failure degrades to the
 * FTS floor instead of aborting the whole migration.
 *
 * Order of operations:
 *   1. pg_trgm — needed for the brain__entities name index (gin_trgm_ops).
 *      Embedded Postgres ships this, so it should always succeed; we
 *      still guard it so an exotic distro without it degrades cleanly.
 *   2. vector — embedded Postgres does NOT ship pgvector. If the
 *      extension installs (external Postgres with pgvector, or a host
 *      that pre-staged the artifact per decision #2), we add the
 *      `embedding vector(768)` column + an HNSW index so the semantic
 *      tier lights up. If it doesn't, we skip silently — the engine
 *      probes for the column at runtime and falls back to FTS-only.
 *
 * Idempotent: re-running is a no-op (IF NOT EXISTS everywhere, and we
 * re-check `vector` availability each boot so adding pgvector later
 * upgrades an existing install on the next restart).
 */
async function ensureBrainVectorTier(db: Db): Promise<void> {
  // 1. pg_trgm — best-effort. The brain__entities GIN index already
  // assumes it; if this fails the index create above would have too,
  // so this is mostly belt-and-suspenders for external Postgres.
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    // Now that pg_trgm exists, the fuzzy entity-name index can be built.
    // Idempotent; coexists with the btree fallback created in the main
    // block (the planner picks whichever a query needs).
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS brain__entities_name_idx
        ON brain__entities USING gin (name gin_trgm_ops)
    `);
  } catch (err) {
    console.warn(
      "[brain-migrate] pg_trgm extension/index unavailable — entity fuzzy-name matching degrades:",
      err instanceof Error ? err.message : err,
    );
  }

  // 2. pgvector — the semantic tier. Embedded Postgres has no
  // vector.control, so this throws there; that's expected and fine.
  let hasVector = false;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    hasVector = true;
  } catch {
    hasVector = false;
  }

  if (!hasVector) {
    console.warn(
      "[brain-migrate] pgvector not available — brain runs on the Postgres FTS floor " +
        "(decision #2). Set DATABASE_URL to a Postgres with pgvector, or stage the " +
        "embedded artifact, to enable the semantic (vector) tier.",
    );
    return;
  }

  // pgvector is present — add the embedding column + HNSW index.
  // Separate execute() calls so a partial failure (e.g. column adds
  // but index create races) still leaves a usable column.
  try {
    await db.execute(
      sql`ALTER TABLE brain__memories ADD COLUMN IF NOT EXISTS embedding vector(768)`,
    );
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS brain__memories_vec_idx
        ON brain__memories USING hnsw (embedding vector_cosine_ops)
    `);
    console.log("[brain-migrate] pgvector enabled — semantic tier active (768-dim).");
  } catch (err) {
    console.warn(
      "[brain-migrate] pgvector present but column/index setup failed — FTS floor:",
      err instanceof Error ? err.message : err,
    );
  }
}

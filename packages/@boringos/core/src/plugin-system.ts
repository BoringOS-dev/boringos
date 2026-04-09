import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { pluginState, pluginJobRuns } from "@boringos/db";
import { generateId } from "@boringos/shared";
import type { AppContext } from "./types.js";

// ── Plugin types ─────────────────────────────────────────────────────────────

export interface PluginJob {
  name: string;
  schedule?: string;
  handler: (ctx: PluginJobContext) => Promise<void>;
}

export interface PluginWebhook {
  event: string;
  handler: (req: PluginWebhookRequest) => Promise<PluginWebhookResponse>;
}

export interface PluginDefinition {
  name: string;
  version: string;
  description?: string;
  configSchema?: Record<string, { type: string; description: string; required?: boolean }>;
  jobs?: PluginJob[];
  webhooks?: PluginWebhook[];
  setup?(ctx: AppContext): Promise<void>;
}

export interface PluginJobContext {
  pluginName: string;
  tenantId: string;
  config: Record<string, unknown>;
  db: Db;
  state: PluginStateStore;
}

export interface PluginWebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  tenantId: string;
  config: Record<string, unknown>;
}

export interface PluginWebhookResponse {
  status: number;
  body?: unknown;
}

// ── Plugin state store ───────────────────────────────────────────────────────

export interface PluginStateStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createPluginStateStore(db: Db, tenantId: string, pluginName: string): PluginStateStore {
  return {
    async get(key: string): Promise<unknown | null> {
      const rows = await db.select().from(pluginState).where(
        and(eq(pluginState.tenantId, tenantId), eq(pluginState.pluginName, pluginName), eq(pluginState.key, key)),
      ).limit(1);
      return rows[0]?.value ?? null;
    },

    async set(key: string, value: unknown): Promise<void> {
      const existing = await db.select().from(pluginState).where(
        and(eq(pluginState.tenantId, tenantId), eq(pluginState.pluginName, pluginName), eq(pluginState.key, key)),
      ).limit(1);

      if (existing[0]) {
        await db.update(pluginState).set({ value: value as any, updatedAt: new Date() }).where(eq(pluginState.id, existing[0].id));
      } else {
        await db.insert(pluginState).values({ id: generateId(), tenantId, pluginName, key, value: value as any });
      }
    },

    async delete(key: string): Promise<void> {
      await db.delete(pluginState).where(
        and(eq(pluginState.tenantId, tenantId), eq(pluginState.pluginName, pluginName), eq(pluginState.key, key)),
      );
    },
  };
}

// ── Plugin registry ──────────────────────────────────────────────────────────

export interface PluginRegistry {
  register(plugin: PluginDefinition): void;
  get(name: string): PluginDefinition | undefined;
  list(): PluginDefinition[];
  getWebhookHandler(pluginName: string, event: string): PluginWebhook | undefined;
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<string, PluginDefinition>();

  return {
    register(plugin: PluginDefinition): void {
      plugins.set(plugin.name, plugin);
    },

    get(name: string): PluginDefinition | undefined {
      return plugins.get(name);
    },

    list(): PluginDefinition[] {
      return Array.from(plugins.values());
    },

    getWebhookHandler(pluginName: string, event: string): PluginWebhook | undefined {
      const plugin = plugins.get(pluginName);
      return plugin?.webhooks?.find((w) => w.event === event);
    },
  };
}

// ── Plugin job runner ────────────────────────────────────────────────────────

export async function runPluginJob(
  db: Db,
  plugin: PluginDefinition,
  job: PluginJob,
  tenantId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const runId = generateId();
  await db.insert(pluginJobRuns).values({
    id: runId,
    tenantId,
    pluginName: plugin.name,
    jobName: job.name,
    status: "running",
  });

  try {
    const state = createPluginStateStore(db, tenantId, plugin.name);
    await job.handler({ pluginName: plugin.name, tenantId, config, db, state });

    await db.update(pluginJobRuns).set({ status: "completed", finishedAt: new Date() }).where(eq(pluginJobRuns.id, runId));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(pluginJobRuns).set({ status: "failed", error, finishedAt: new Date() }).where(eq(pluginJobRuns.id, runId));
  }
}

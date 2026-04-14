import type { MemoryProvider } from "@boringos/memory";
import type { RuntimeModule, RuntimeRegistry } from "@boringos/runtime";
import type { StorageBackend } from "@boringos/drive";
import type { DatabaseConfig } from "@boringos/db";
import type { AgentEngine, ContextProvider } from "@boringos/agent";
import type { WorkflowEngine, BlockHandler } from "@boringos/workflow";
import type { SkillProvider } from "@boringos/shared";
import type { EventBus } from "@boringos/connector";

// ── BoringOS — the application host ────────────────────────────────────────

export interface BoringOSConfig {
  database?: DatabaseConfig;
  redis?: string;
  auth?: AuthConfig;
  drive?: DriveAppConfig;
  logging?: LogConfig;
}

export interface AuthConfig {
  secret: string;
  adminKey?: string;
  url?: string;
  tokenExpirySeconds?: number;
}

export interface DriveAppConfig {
  root?: string;
  backend?: StorageBackend;
}

export interface LogConfig {
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  pretty?: boolean;
}

// ── AppContext — the dependency injection container ───────────────────────────

export interface AppContext {
  config: BoringOSConfig;
  db: unknown;
  memory: MemoryProvider;
  drive: StorageBackend | null;
  runtimes: RuntimeRegistry;
  agentEngine: AgentEngine | null;
  workflowEngine: WorkflowEngine | null;
  eventBus: EventBus;
}

// ── Component registration types ─────────────────────────────────────────────

export interface ConnectorDefinition extends SkillProvider {
  name: string;
  type: string;
  setup?(ctx: AppContext): Promise<void>;
}

export interface SkillDefinition {
  key: string;
  name: string;
  source: SkillSource;
  trustLevel?: "markdown_only" | "assets" | "scripts_executables";
}

export type SkillSource =
  | { type: "local"; path: string }
  | { type: "github"; repo: string; path?: string; ref?: string }
  | { type: "url"; url: string };

export interface PersonaBundle {
  agentsMd?: string;
  soulMd?: string;
  heartbeatMd?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  setup(ctx: AppContext): Promise<void>;
}

// ── Lifecycle hooks ──────────────────────────────────────────────────────────

export type LifecycleHook = (ctx: AppContext) => Promise<void>;

// ── Started server ───────────────────────────────────────────────────────────

export interface StartedServer {
  url: string;
  port: number;
  context: AppContext;
  close(): Promise<void>;
}

export interface TestInstance extends StartedServer {
  reset(): Promise<void>;
}

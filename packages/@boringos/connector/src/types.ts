import type { SkillProvider } from "@boringos/shared";

// ── ConnectorDefinition — the one interface connector authors implement ──────

export interface ConnectorDefinition extends SkillProvider {
  readonly kind: string;
  readonly name: string;
  readonly description: string;

  oauth?: OAuthConfig;
  events: EventDefinition[];
  actions: ActionDefinition[];

  setup?(ctx: ConnectorContext): Promise<void>;
  handleWebhook?(req: WebhookRequest): Promise<WebhookResponse>;
  createClient(credentials: ConnectorCredentials): ConnectorClient;

  /**
   * Workflows the framework should install for a tenant the first time
   * this connector connects (N5). Each spec includes an optional cron
   * routine — the canonical use is "Gmail sync every 15 minutes". The
   * installer is idempotent on the spec's `tag`.
   */
  defaultWorkflows?(): DefaultWorkflowSpec[];
}

/**
 * Workflow + routine the framework auto-installs when a tenant connects
 * a connector. The connector author owns the spec; the framework owns
 * the persist + idempotency.
 */
export interface DefaultWorkflowSpec {
  /** Stable identifier — used for idempotent re-install on reconnect. */
  tag: string;
  name: string;
  description?: string;
  blocks: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  /** Optional cron routine that triggers the workflow. */
  routine?: {
    title: string;
    cronExpression: string;
    timezone?: string;
  };
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce?: boolean;
  extraParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

// ── Events — what connectors emit ────────────────────────────────────────────

export interface EventDefinition {
  type: string;
  description: string;
  schema?: Record<string, unknown>;
}

export interface ConnectorEvent {
  connectorKind: string;
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

// ── Actions — what agents can invoke ─────────────────────────────────────────

export interface ActionDefinition {
  name: string;
  description: string;
  inputs: Record<string, ActionFieldDef>;
  outputs?: Record<string, ActionFieldDef>;
}

export interface ActionFieldDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
}

export interface ActionRequest {
  connectorKind: string;
  action: string;
  tenantId: string;
  /**
   * Agent caller identity (callback API path). Mutually exclusive with
   * `userId` — exactly one is set per call. Human-initiated calls from
   * the shell carry `userId` instead.
   */
  agentId?: string;
  /** Human caller identity (session-authenticated path). */
  userId?: string;
  inputs: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ── Client — created per tenant with credentials ─────────────────────────────

export interface ConnectorClient {
  executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult>;
}

// ── Credentials — stored in connectors table ─────────────────────────────────

export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  config?: Record<string, unknown>;
}

// ── Setup context ────────────────────────────────────────────────────────────

export interface ConnectorContext {
  tenantId: string;
  credentials: ConnectorCredentials;
  webhookUrl: string;
}

// ── Webhook handling ─────────────────────────────────────────────────────────

export interface WebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  tenantId: string;
}

export interface WebhookResponse {
  status: number;
  body?: unknown;
  events?: ConnectorEvent[];
}

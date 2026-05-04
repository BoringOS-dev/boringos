// SPDX-License-Identifier: MIT
//
// defineConnector — produces a typed ConnectorDefinition that the runtime
// can consume. Identity helper: returns its input narrowed to the literal
// shape so downstream code gets exact field types.
//
// Structurally compatible with @boringos/connector's ConnectorDefinition.
// We re-declare the shape in the SDK so this package stays standalone
// (third-party developers depend only on @boringos/app-sdk, not the kernel).

/* ── Connector runtime definition ──────────────────────────────────── */

/**
 * The runtime object a connector exports. The manifest (boringos.json)
 * describes this declaratively for the install pipeline; this is the
 * actual JavaScript value the runtime registers.
 *
 * Note on field naming: this object's `kind` field holds the connector's
 * *identifier* (e.g. "slack"), which the new manifest layer calls `id`.
 * The runtime field name stays as `kind` for backwards compatibility with
 * existing connectors. See docs/developer/migrate-existing-connectors.md.
 */
export interface ConnectorDefinition {
  /** Connector identifier (e.g. "slack"). Matches the manifest's `id`. */
  readonly kind: string;

  /** Display name. */
  readonly name: string;

  readonly description: string;

  /** OAuth2 config (most common). Use `setup` for custom auth flows. */
  oauth?: ConnectorOAuthConfig;

  events: ConnectorEventDefinition[];

  actions: ConnectorActionDefinition[];

  /** One-time setup hook called per tenant install. */
  setup?(ctx: ConnectorSetupContext): Promise<void>;

  /** Single webhook entry point. Connector-internal routing happens inside. */
  handleWebhook?(req: ConnectorWebhookRequest): Promise<ConnectorWebhookResponse>;

  /** Factory: produce a per-tenant client from stored credentials. */
  createClient(credentials: ConnectorCredentials): ConnectorClient;
}

export interface ConnectorOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce?: boolean;
  extraParams?: Record<string, string>;
}

export interface ConnectorEventDefinition {
  /** Event identifier (e.g. "message_received"). Phase 0: events use `type`. */
  type: string;
  description: string;
  schema?: Record<string, unknown>;
}

export interface ConnectorActionDefinition {
  /** Action identifier (e.g. "send_message"). Phase 0: actions use `name`. */
  name: string;
  description: string;
  inputs: Record<string, ConnectorActionField>;
  outputs?: Record<string, ConnectorActionField>;
}

export interface ConnectorActionField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
}

export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  config?: Record<string, unknown>;
}

export interface ConnectorClient {
  executeAction(action: string, inputs: Record<string, unknown>): Promise<ConnectorActionResult>;
}

export interface ConnectorActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ConnectorSetupContext {
  tenantId: string;
  credentials: ConnectorCredentials;
  webhookUrl: string;
}

export interface ConnectorWebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  tenantId: string;
}

export interface ConnectorWebhookResponse {
  status: number;
  body?: unknown;
  events?: Array<{
    connectorKind: string;
    type: string;
    tenantId: string;
    data: Record<string, unknown>;
    timestamp: Date;
  }>;
}

/* ── Helper ────────────────────────────────────────────────────────── */

/**
 * Identity helper that narrows the argument to a typed ConnectorDefinition.
 *
 * Generic parameter preserves literal types so consumers get exact
 * inference on `kind`, action names, event types, etc.
 *
 * @example
 * ```ts
 * export default defineConnector({
 *   kind: "stripe",
 *   name: "Stripe",
 *   description: "Payments and invoices.",
 *   events: [{ type: "payment_received", description: "..." }],
 *   actions: [{ name: "create_invoice", description: "...", inputs: {} }],
 *   createClient: (creds) => new StripeClient(creds),
 * });
 * ```
 */
export function defineConnector<const T extends ConnectorDefinition>(def: T): T {
  return def;
}

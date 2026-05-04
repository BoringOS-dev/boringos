// SPDX-License-Identifier: MIT
//
// Manifest types — the contract every app and connector ships in
// `boringos.json` at its package root.
//
// Field naming (per Phase 0 decisions):
//   - `kind`  — extension type discriminator ("connector" | "app")
//   - `id`    — instance identifier (e.g. "slack", "crm")
//   - `type`  — event identifier (matches existing @boringos/connector code)
//   - `name`  — action identifier (matches existing @boringos/connector code)
//
// The full capability scope catalog lives in docs/capabilities.md.

/* ── Top-level discriminated union ─────────────────────────────────── */

export type Manifest = ConnectorManifest | AppManifest;

/* ── Shared base ───────────────────────────────────────────────────── */

export interface BaseManifest {
  /** Extension type discriminator. */
  kind: "connector" | "app";

  /** Globally unique, kebab-case (e.g. "slack", "crm"). */
  id: string;

  /** Semver. */
  version: string;

  /** Display name. */
  name: string;

  description: string;

  publisher: PublisherInfo;

  /** Minimum BoringOS runtime version this extension requires. */
  minRuntime: string;

  /** SPDX license identifier (e.g. "MIT", "BUSL-1.1", "Proprietary"). */
  license: string;
}

export interface PublisherInfo {
  name: string;
  homepage?: string;
  supportEmail?: string;
  /** Set by the marketplace, never by the publisher. */
  verified?: boolean;
}

/* ── Capability scopes ─────────────────────────────────────────────── */

/**
 * A capability scope string. Validated at install time against the catalog
 * and against what the bundle actually does.
 *
 * Examples:
 *   "entities.own:write"
 *   "events:emit:slack.*"
 *   "slots:nav"
 *   "connectors:use:google"
 *
 * See docs/capabilities.md for the full catalog.
 */
export type Capability = string;

/* ── Connector manifest ────────────────────────────────────────────── */

export interface ConnectorManifest extends BaseManifest {
  kind: "connector";

  /** Relative path to the compiled JS module exporting a ConnectorDefinition. */
  entry: string;

  auth: AuthConfig;

  events: EventDeclaration[];

  actions: ActionDeclaration[];

  webhooks?: WebhookDeclaration[];

  /**
   * Relative paths to markdown skill files describing how agents should
   * use this connector. The runtime concatenates and injects them into
   * agent prompts.
   */
  skills?: string[];

  capabilities: Capability[];
}

export type AuthConfig = OAuth2AuthConfig | ApiKeyAuthConfig | CustomAuthConfig;

export interface OAuth2AuthConfig {
  type: "oauth2";
  /** Provider key (e.g. "slack", "google", or a custom name). */
  provider: string;
  scopes: string[];
  authorizationUrl?: string;
  tokenUrl?: string;
}

export interface ApiKeyAuthConfig {
  type: "apikey";
  fields: ApiKeyField[];
}

export interface ApiKeyField {
  name: string;
  label: string;
  /** If true, the value is treated as a secret (masked, not logged). */
  secret: boolean;
}

export interface CustomAuthConfig {
  type: "custom";
  /** Free-form description for the install UI. */
  description?: string;
}

export interface EventDeclaration {
  /**
   * Event identifier. Namespaced by connector kind:
   *   "slack.message_received"
   *   "stripe.payment_received"
   *
   * Phase 0 naming: events use `type` (matches existing connector code).
   */
  type: string;

  description: string;

  /** Relative path to the JSON Schema validating this event's payload. */
  schema?: string;
}

export interface ActionDeclaration {
  /**
   * Action identifier (e.g. "send_message").
   *
   * Phase 0 naming: actions use `name` (matches existing connector code).
   */
  name: string;

  description: string;

  /** Relative path to JSON Schema for the action's input. */
  inputSchema: string;

  /** Relative path to JSON Schema for the action's output. */
  outputSchema?: string;
}

export interface WebhookDeclaration {
  /** Connector event type emitted when this webhook fires. */
  event: string;

  /** Mounted at /webhooks/connectors/{id}{path}. Metadata only — internal routing stays in handleWebhook. */
  path: string;
}

/* ── App manifest ──────────────────────────────────────────────────── */

export interface AppManifest extends BaseManifest {
  kind: "app";

  /**
   * Hosting model. v1 supports only "in-process".
   *
   * The "remote" variant is reserved for a future release; the SDK is shaped
   * to allow a remote dispatcher to be added later without a breaking change.
   * See docs/developer/building-apps.md § 5.
   */
  hosting: "in-process";

  /** Relative path to schema migrations directory. */
  schema?: string;

  entityTypes: EntityTypeDeclaration[];

  /** Relative path to a module exporting agent definitions. */
  agents?: string;

  /** Relative path to a module exporting workflow templates. */
  workflows?: string;

  /** Relative path to a module exporting context providers. */
  contextProviders?: string;

  /** Relative path to a module exporting route registrations. */
  routes?: string;

  ui: UIManifest;

  /**
   * Relative paths to markdown skill files describing how agents should
   * use this app. The runtime concatenates and injects them into agent prompts.
   */
  skills?: string[];

  capabilities: Capability[];

  /** Other apps this app depends on (cross-app entity reads, etc.). */
  dependencies?: AppDependency[];
}

export interface EntityTypeDeclaration {
  /** App-namespaced (e.g. "crm_contact"). */
  id: string;

  /** Display label. */
  label: string;

  icon?: string;

  /**
   * If true, other apps may request `entities.{app_id}:read` against this
   * type. The owning app's manifest gates cross-app access.
   */
  shareable?: boolean;
}

export interface UIManifest {
  /** Relative path to the compiled UI bundle exporting a UIDefinition. */
  entry: string;

  nav?: NavEntryDeclaration[];
  dashboardWidgets?: string[];
  entityActions?: EntityActionDeclaration[];
  settingsPanels?: string[];
  copilotTools?: string[];
  commandActions?: string[];
  inboxHandlers?: string[];
}

export interface NavEntryDeclaration {
  id: string;
  label: string;
  icon?: string;
  /** Lower numbers sort earlier. */
  order?: number;
}

export interface EntityActionDeclaration {
  /** Entity type this action attaches to (e.g. "crm_deal"). */
  entity: string;
  id: string;
  label: string;
  icon?: string;
}

export interface AppDependency {
  /** The other app's id (e.g. "crm"). */
  appId: string;

  /** Semver range of acceptable versions (e.g. "^1.0.0"). */
  versionRange: string;
}

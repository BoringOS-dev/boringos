// SPDX-License-Identifier: MIT
//
// @boringos/app-sdk — public SDK for building apps and connectors on BoringOS.

/**
 * SDK version. Bumped per Phase 1 / Phase 2 / Phase 3 contract changes.
 * The first published alpha is 1.0.0-alpha.0 (see TASK-B5).
 */
export const SDK_VERSION = "0.0.1" as const;

/* ── Manifest types (TASK-B2) ──────────────────────────────────────── */

export type {
  Manifest,
  BaseManifest,
  PublisherInfo,
  Capability,

  // Connector
  ConnectorManifest,
  AuthConfig,
  OAuth2AuthConfig,
  ApiKeyAuthConfig,
  ApiKeyField,
  CustomAuthConfig,
  EventDeclaration,
  ActionDeclaration,
  WebhookDeclaration,

  // App
  AppManifest,
  EntityTypeDeclaration,
  UIManifest,
  NavEntryDeclaration,
  EntityActionDeclaration,
  AppDependency,
} from "./manifest.js";

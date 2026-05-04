// SPDX-License-Identifier: MIT
//
// @boringos/connector-sdk — focused entry point for connector authors.
//
// Re-exports the connector-relevant subset of @boringos/app-sdk so authors
// of integrations (Stripe, HubSpot, Zendesk, etc.) can import only what
// they need without seeing app/UI types.
//
// If you are building a full domain app (CRM, Accounts, etc.) use
// @boringos/app-sdk directly.

export { defineConnector, SDK_VERSION } from "@boringos/app-sdk";

export type {
  // Manifest
  ConnectorManifest,
  BaseManifest,
  PublisherInfo,
  Capability,
  AuthConfig,
  OAuth2AuthConfig,
  ApiKeyAuthConfig,
  ApiKeyField,
  CustomAuthConfig,
  EventDeclaration,
  ActionDeclaration,
  WebhookDeclaration,

  // Runtime definition
  ConnectorDefinition,
  ConnectorOAuthConfig,
  ConnectorEventDefinition,
  ConnectorActionDefinition,
  ConnectorActionField,
  ConnectorCredentials,
  ConnectorClient,
  ConnectorActionResult,
  ConnectorSetupContext,
  ConnectorWebhookRequest,
  ConnectorWebhookResponse,
} from "@boringos/app-sdk";

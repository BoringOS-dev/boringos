// SPDX-License-Identifier: BUSL-1.1
//
// Typed wrappers around /api/connectors/* for the shell. Mirrors the
// pattern in Workflows.tsx — read auth headers from the configured
// client, hand off via fetch().

import type { ConnectorStatusRow } from "./connectorsPresenter.js";

export interface ConnectorClientConfig {
  url?: string;
  token?: string;
  tenantId?: string;
}

function buildHeaders(cfg: ConnectorClientConfig | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (cfg?.token) h["Authorization"] = `Bearer ${cfg.token}`;
  if (cfg?.tenantId) h["X-Tenant-Id"] = cfg.tenantId;
  return h;
}

export async function fetchConnectorStatus(
  cfg: ConnectorClientConfig | undefined,
): Promise<ConnectorStatusRow[]> {
  const base = cfg?.url ?? "";
  const res = await fetch(`${base}/api/connectors/status`, {
    headers: buildHeaders(cfg),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { connectors?: ConnectorStatusRow[] };
  return body.connectors ?? [];
}

/**
 * Build the absolute URL the Add button kicks the user to. The framework
 * resolves tenant from session, but the existing /authorize handler also
 * accepts ?tenantId=...; we pass it explicitly so we don't depend on
 * session resolution working from a top-level redirect.
 *
 * `returnTo` (N2) tells the framework where to send the user after the
 * provider's callback completes. It must be a same-origin URL — the
 * server validates it against an allowlist and falls back to /connectors
 * if the value is missing or unsafe.
 */
export function buildAuthorizeUrl(
  kind: string,
  cfg: ConnectorClientConfig | undefined,
  returnTo?: string,
): string {
  const base = cfg?.url ?? "";
  const params = new URLSearchParams();
  if (cfg?.tenantId) params.set("tenantId", cfg.tenantId);
  if (returnTo) params.set("returnTo", returnTo);
  const qs = params.toString();
  return `${base}/api/connectors/oauth/${kind}/authorize${qs ? `?${qs}` : ""}`;
}

export async function disconnectConnector(
  kind: string,
  cfg: ConnectorClientConfig | undefined,
): Promise<void> {
  const base = cfg?.url ?? "";
  const res = await fetch(`${base}/api/connectors/disconnect/${kind}`, {
    method: "POST",
    headers: buildHeaders(cfg),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
}

// SPDX-License-Identifier: BUSL-1.1
//
// Connectors screen. Replaces the Phase 1 placeholder. Lists every
// connector kind registered with the framework plus the per-tenant
// connection status. Add / Disconnect / Reconnect routes hand off to
// the OAuth endpoints in @boringos/core/connector-routes.
//
// N1: page + cards
// N2/N3: signed authorize/callback (in connector-routes.ts)
// N4: Add wizard modal — confirm scopes before redirecting
// N5+ layer on top of this.

import { useEffect, useState } from "react";
import { useClient } from "@boringos/ui";

import {
  EmptyState,
  LoadingState,
  ScreenBody,
  ScreenHeader,
} from "../_shared.js";
import { AddConnectorModal } from "./AddConnectorModal.js";
import { ConnectorCard } from "./ConnectorCard.js";
import { DisconnectModal } from "./DisconnectModal.js";
import {
  buildPageViewModel,
  type ConnectorStatusRow,
  type ConnectorViewModel,
} from "./connectorsPresenter.js";
import {
  buildAuthorizeUrl,
  disconnectConnector,
  fetchConnectorStatus,
  type ConnectorClientConfig,
} from "./connectorsApi.js";

function getConfig(client: unknown): ConnectorClientConfig | undefined {
  return (client as { config?: ConnectorClientConfig }).config;
}

function buildReturnTo(): string | undefined {
  return typeof window !== "undefined"
    ? `${window.location.origin}/connectors`
    : undefined;
}

export function Connectors() {
  const client = useClient();
  const [rows, setRows] = useState<ConnectorStatusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<ConnectorViewModel | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<ConnectorViewModel | null>(null);

  const cfg = getConfig(client);

  // Read OAuth callback feedback from URL on mount; remove the params
  // so a refresh doesn't re-render the banner indefinitely.
  const [callbackBanner, setCallbackBanner] = useState<
    | { kind: "success"; connectorName: string }
    | { kind: "error"; connectorName: string; reason: string }
    | null
  >(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    const kind = params.get("kind");
    if (!connect || !kind) return;

    const reason = params.get("reason") ?? "unknown";
    const name = kind;
    if (connect === "success") {
      setCallbackBanner({ kind: "success", connectorName: name });
    } else if (connect === "error") {
      setCallbackBanner({ kind: "error", connectorName: name, reason });
    }
    // Clean the URL so the banner doesn't redisplay on refresh.
    params.delete("connect");
    params.delete("kind");
    params.delete("reason");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);

    fetchConnectorStatus(cfg)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [cfg?.url, cfg?.token, cfg?.tenantId]);

  const vm = buildPageViewModel(rows);

  const startAuthorize = (kind: string) => {
    window.location.href = buildAuthorizeUrl(kind, cfg, buildReturnTo());
  };

  const handleAdd = (kind: string) => {
    // Show the wizard modal so the user sees the scopes they're granting
    // before being redirected. The card already has the scopes; we
    // re-resolve from vm.cards so the modal owns its data source.
    const card = vm.cards.find((c) => c.kind === kind);
    if (!card) return;
    setPendingAdd(card);
  };

  const handleConfirmAdd = (kind: string) => {
    setPendingAdd(null);
    startAuthorize(kind);
  };

  const handleReconnect = (kind: string) => {
    // Reconnect skips the modal — the user has already granted these
    // scopes once. Providers usually skip the consent screen on a
    // re-auth from the same client.
    startAuthorize(kind);
  };

  const handleDisconnect = (kind: string) => {
    const card = vm.cards.find((c) => c.kind === kind);
    if (!card) return;
    setPendingDisconnect(card);
  };

  const handleConfirmDisconnect = async (kind: string) => {
    setPendingDisconnect(null);
    setActionError(null);
    try {
      await disconnectConnector(kind, cfg);
      const fresh = await fetchConnectorStatus(cfg);
      setRows(fresh);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <ScreenHeader
        title="Connectors"
        subtitle="OAuth into Gmail, Slack, and other services"
      />
      <ScreenBody>
        {callbackBanner?.kind === "success" && (
          <div className="mb-4 rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between">
            <span>
              Connected {callbackBanner.connectorName}. Sync workflows
              are now running on your behalf.
            </span>
            <button
              onClick={() => setCallbackBanner(null)}
              className="text-emerald-600 hover:text-emerald-900"
            >
              ×
            </button>
          </div>
        )}
        {callbackBanner?.kind === "error" && (
          <div className="mb-4 rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700 flex items-center justify-between">
            <span>
              Couldn't connect {callbackBanner.connectorName}:{" "}
              <span className="font-mono">{callbackBanner.reason}</span>
            </span>
            <button
              onClick={() => setCallbackBanner(null)}
              className="text-rose-500 hover:text-rose-900"
            >
              ×
            </button>
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-md bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-700">
            {actionError}
          </div>
        )}

        {error ? (
          <EmptyState
            title="Couldn't load connectors"
            description={error}
          />
        ) : rows === null ? (
          <LoadingState />
        ) : vm.isEmpty ? (
          <EmptyState
            title="No connectors registered"
            description="Connectors are added by the framework or by installed apps. Install an app to add more, or wait for the framework to register one."
          />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {vm.cards.map((c) => (
              <ConnectorCard
                key={c.kind}
                vm={c}
                onAdd={handleAdd}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
              />
            ))}
          </ul>
        )}
      </ScreenBody>

      {pendingAdd && (
        <AddConnectorModal
          vm={pendingAdd}
          onConfirm={handleConfirmAdd}
          onCancel={() => setPendingAdd(null)}
        />
      )}

      {pendingDisconnect && (
        <DisconnectModal
          vm={pendingDisconnect}
          onConfirm={handleConfirmDisconnect}
          onCancel={() => setPendingDisconnect(null)}
        />
      )}
    </>
  );
}

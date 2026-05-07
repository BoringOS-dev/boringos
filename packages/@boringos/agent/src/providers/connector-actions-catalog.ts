// SPDX-License-Identifier: BUSL-1.1
//
// Connector-actions catalog. Emits a "## Available tools — connector
// actions" section into every agent's system prompt listing every
// callable action across every CONNECTED connector for the tenant.
//
// Sources:
//   • `connectorRegistry.list()` — every connector the framework
//     knows how to operate (the static catalog).
//   • `connectors` DB table — which of those the current tenant
//     has actually connected.
//
// We only advertise the intersection. Unconnected connectors don't
// litter the prompt with calls the agent would 401-on if it tried
// them.
//
// Why this provider exists: agents have Bash + curl + a bearer
// token, but no idea that `/api/connectors/actions/google/send_email`
// is a thing. Without this section, asking the agent to send an
// email after approval results in… nothing happening. The
// `approvals-skill` provider tells the agent to look at this
// catalog when it needs to act.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors as connectorsTable } from "@boringos/db";
import type { ConnectorRegistry, ConnectorDefinition, ActionDefinition, ActionFieldDef } from "@boringos/connector";

import type { ContextProvider, ContextBuildEvent } from "../types.js";

export interface ConnectorActionsCatalogDeps {
  registry: ConnectorRegistry;
  db: Db;
}

export function createConnectorActionsCatalogProvider(
  deps: ConnectorActionsCatalogDeps,
): ContextProvider {
  return {
    name: "connector-actions-catalog",
    phase: "system",
    priority: 75,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const definitions = deps.registry.list();
      if (definitions.length === 0) return null;

      // Find the connectors actually wired for this tenant. Empty
      // result → no point emitting anything.
      let connectedKinds: Set<string>;
      try {
        const rows = await deps.db
          .select({ kind: connectorsTable.kind })
          .from(connectorsTable)
          .where(
            and(
              eq(connectorsTable.tenantId, event.tenantId),
              eq(connectorsTable.status, "active"),
            ),
          );
        connectedKinds = new Set(rows.map((r) => r.kind));
      } catch {
        return null;
      }
      if (connectedKinds.size === 0) return null;

      const connected = definitions.filter((d) => connectedKinds.has(d.kind));
      if (connected.length === 0) return null;

      const lines: string[] = [];
      lines.push("## Available tools — connector actions");
      lines.push("");
      lines.push(
        "Each action below is callable by curling the framework's " +
          "connector-actions endpoint. Your `$BORINGOS_CALLBACK_TOKEN` " +
          "authorizes you against the tenant's stored connector " +
          "credentials — you do NOT authenticate with the third-party " +
          "service directly.",
      );
      lines.push("");
      lines.push(
        "Endpoint shape: `POST $BORINGOS_CALLBACK_URL/api/connectors/actions/<kind>/<action>`",
      );
      lines.push("");

      for (const conn of connected) {
        if (conn.actions.length === 0) continue;
        lines.push(`### ${conn.name} (\`${conn.kind}\`)`);
        if (conn.description) {
          lines.push(`_${conn.description}_`);
        }
        lines.push("");
        for (const action of conn.actions) {
          lines.push(...formatAction(conn.kind, action, event.callbackUrl));
          lines.push("");
        }
      }

      return lines.join("\n");
    },
  };
}

function formatAction(
  kind: string,
  action: ActionDefinition,
  callbackUrl: string,
): string[] {
  const lines: string[] = [];
  lines.push(`#### \`${kind}.${action.name}\` — ${action.description}`);

  const inputEntries = Object.entries(action.inputs);
  if (inputEntries.length > 0) {
    lines.push("Inputs:");
    for (const [name, def] of inputEntries) {
      const reqd = def.required ? ", required" : "";
      lines.push(`- \`${name}\` (${def.type}${reqd}) — ${def.description}`);
    }
    lines.push("");
  }

  // Curl skeleton with placeholders matching the input types so an
  // agent can copy/paste and just edit values.
  const sampleBody = sampleInputs(action.inputs);
  lines.push("Example call:");
  lines.push("```bash");
  lines.push(`curl -sS -X POST $BORINGOS_CALLBACK_URL/api/connectors/actions/${kind}/${action.name} \\`);
  lines.push(`  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '${JSON.stringify(sampleBody)}'`);
  lines.push("```");
  return lines;
}

function sampleInputs(inputs: Record<string, ActionFieldDef>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(inputs)) {
    switch (def.type) {
      case "string":
        out[name] = `<${name}>`;
        break;
      case "number":
        out[name] = 0;
        break;
      case "boolean":
        out[name] = false;
        break;
      case "array":
        out[name] = [];
        break;
      case "object":
      default:
        out[name] = {};
    }
  }
  return out;
}

// Re-export so the connector type doesn't need a separate import for callers.
export type { ConnectorDefinition };

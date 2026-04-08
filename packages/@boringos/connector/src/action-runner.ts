import type { ConnectorRegistry } from "./registry.js";
import type { ActionRequest, ActionResult, ConnectorCredentials } from "./types.js";

export interface ActionRunner {
  execute(request: ActionRequest, credentials: ConnectorCredentials): Promise<ActionResult>;
}

export function createActionRunner(registry: ConnectorRegistry): ActionRunner {
  return {
    async execute(request: ActionRequest, credentials: ConnectorCredentials): Promise<ActionResult> {
      const connector = registry.get(request.connectorKind);
      if (!connector) {
        return { success: false, error: `Unknown connector: ${request.connectorKind}` };
      }

      const actionDef = connector.actions.find((a) => a.name === request.action);
      if (!actionDef) {
        return { success: false, error: `Unknown action: ${request.action} on ${request.connectorKind}` };
      }

      try {
        const client = connector.createClient(credentials);
        return await client.executeAction(request.action, request.inputs);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

import type { ConnectorDefinition } from "./types.js";

export interface ConnectorRegistry {
  register(connector: ConnectorDefinition): void;
  get(kind: string): ConnectorDefinition | undefined;
  list(): ConnectorDefinition[];
  has(kind: string): boolean;
}

export function createConnectorRegistry(): ConnectorRegistry {
  const connectors = new Map<string, ConnectorDefinition>();

  return {
    register(connector: ConnectorDefinition): void {
      connectors.set(connector.kind, connector);
    },

    get(kind: string): ConnectorDefinition | undefined {
      return connectors.get(kind);
    },

    list(): ConnectorDefinition[] {
      return Array.from(connectors.values());
    },

    has(kind: string): boolean {
      return connectors.has(kind);
    },
  };
}

import type {
  ConnectorDefinition,
  ConnectorEvent,
  ConnectorCredentials,
  ActionResult,
  WebhookRequest,
  WebhookResponse,
} from "./types.js";
import { createEventBus } from "./event-bus.js";
import type { EventBus } from "./event-bus.js";

export interface ConnectorTestHarness {
  /** Simulated event bus — inspect emitted events */
  events: EventBus;
  emittedEvents: ConnectorEvent[];

  /** Execute an action via the connector's client */
  executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult>;

  /** Simulate an incoming webhook */
  simulateWebhook(body: unknown, headers?: Record<string, string>): Promise<WebhookResponse | null>;

  /** Get the connector's skill markdown */
  skillMarkdown(): string | null;

  /** Get the connector definition */
  definition: ConnectorDefinition;
}

export function createConnectorTestHarness(
  connector: ConnectorDefinition,
  credentials?: ConnectorCredentials,
): ConnectorTestHarness {
  const events = createEventBus();
  const emittedEvents: ConnectorEvent[] = [];

  events.onAny((event) => {
    emittedEvents.push(event);
  });

  const creds: ConnectorCredentials = credentials ?? {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
  };

  const client = connector.createClient(creds);

  return {
    events,
    emittedEvents,

    async executeAction(action: string, inputs: Record<string, unknown>): Promise<ActionResult> {
      return client.executeAction(action, inputs);
    },

    async simulateWebhook(body: unknown, headers?: Record<string, string>): Promise<WebhookResponse | null> {
      if (!connector.handleWebhook) return null;

      const req: WebhookRequest = {
        method: "POST",
        headers: headers ?? {},
        body,
        tenantId: "test-tenant",
      };

      const response = await connector.handleWebhook(req);

      // Emit any events from the webhook response
      if (response.events) {
        for (const event of response.events) {
          await events.emit(event);
        }
      }

      return response;
    },

    skillMarkdown(): string | null {
      return connector.skillMarkdown();
    },

    definition: connector,
  };
}

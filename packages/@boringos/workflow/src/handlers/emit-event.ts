import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * emit-event block handler — emits a connector event from within a workflow.
 * This allows routeToInbox() and other event listeners to catch workflow-generated events.
 *
 * Config:
 *   - connectorKind: string — e.g., "google", "slack"
 *   - eventType: string — e.g., "email_received", "message_received"
 *   - data: object — event data (supports templates)
 *   - items: array — if provided, emits one event per item
 *
 * Requires "eventBus" service (from @boringos/connector EventBus).
 */
export const emitEventHandler: BlockHandler = {
  types: ["emit-event"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const eventBus = ctx.services.get("eventBus") as { emit(event: unknown): Promise<void> } | undefined;

    const connectorKind = (ctx.config.connectorKind as string) ?? "workflow";
    const eventType = (ctx.config.eventType as string) ?? "item_processed";
    const tenantId = ctx.tenantId;
    let emitted = 0;

    const items = ctx.config.items;
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        if (eventBus) {
          await eventBus.emit({
            connectorKind,
            type: eventType,
            tenantId,
            data: item as Record<string, unknown>,
            timestamp: new Date(),
          });
        }
        emitted++;
      }
    } else {
      if (eventBus) {
        await eventBus.emit({
          connectorKind,
          type: eventType,
          tenantId,
          data: (ctx.config.data as Record<string, unknown>) ?? {},
          timestamp: new Date(),
        });
      }
      emitted = 1;
    }

    return {
      output: { emitted, eventType },
    };
  },
};

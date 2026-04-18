import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * create-inbox-item block handler — stores data in the inbox.
 * Used in sync workflows to persist fetched data before agent processing.
 *
 * Emits "inbox.item_created" event for each new item so agents can react.
 *
 * Config:
 *   - source: string — where the item came from (e.g., "gmail", "slack")
 *   - subject: string — item subject/title (supports templates)
 *   - body: string — item body/content (supports templates)
 *   - from: string — sender (supports templates)
 *   - assigneeUserId: string — optional user to assign to
 *   - items: array — if provided, creates one inbox item per array element
 *     Each element should have { subject, body?, from? }
 *
 * Requires "db" service. Optionally uses "eventBus" service.
 */
export const createInboxItemHandler: BlockHandler = {
  types: ["create-inbox-item"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const db = ctx.services.get("db") as import("@boringos/db").Db | undefined;
    if (!db) {
      return { output: { error: "db service not available", created: 0 } };
    }

    const { inboxItems } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");

    const eventBus = ctx.services.get("eventBus") as { emit(event: unknown): Promise<void> } | undefined;

    const source = (ctx.config.source as string) ?? "workflow";
    const tenantId = ctx.tenantId;
    let created = 0;
    const createdIds: string[] = [];

    // Batch mode — create from array (may arrive as JSON string from template resolution)
    const hasItemsConfig = "items" in ctx.config;
    let items: unknown = ctx.config.items;
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    // If `items` was configured (even if it resolved to empty/invalid), stay in batch mode.
    // Otherwise a zero-fetch sync tick would fall through to single-item mode and insert a
    // junk row with unresolved template values.
    if (hasItemsConfig) {
      if (!Array.isArray(items) || items.length === 0) {
        return { output: { created: 0, source, itemIds: [] } };
      }
      const { eq, and } = await import("drizzle-orm");
      for (const item of items) {
        const entry = item as Record<string, unknown>;
        const sourceId = (entry.id as string) ?? (entry.messageId as string) ?? null;

        // Dedup: skip if sourceId already exists for this tenant+source
        if (sourceId) {
          const existing = await db.select({ id: inboxItems.id }).from(inboxItems)
            .where(and(eq(inboxItems.tenantId, tenantId), eq(inboxItems.source, source), eq(inboxItems.sourceId, sourceId)))
            .limit(1);
          if (existing.length > 0) continue;
        }

        const itemId = generateId();
        await db.insert(inboxItems).values({
          id: itemId,
          tenantId,
          source,
          subject: (entry.subject as string) ?? (entry.summary as string) ?? (entry.title as string) ?? "No subject",
          body: (entry.body as string) ?? (entry.snippet as string) ?? (entry.description as string) ?? null,
          from: (entry.from as string) ?? null,
          assigneeUserId: (entry.assigneeUserId as string) ?? (ctx.config.assigneeUserId as string) ?? null,
          sourceId,
          metadata: entry,
        });
        created++;
        createdIds.push(itemId);
      }
    } else {
      // Single item mode
      const itemId = generateId();
      await db.insert(inboxItems).values({
        id: itemId,
        tenantId,
        source,
        subject: (ctx.config.subject as string) ?? "No subject",
        body: (ctx.config.body as string) ?? null,
        from: (ctx.config.from as string) ?? null,
        assigneeUserId: (ctx.config.assigneeUserId as string) ?? null,
      });
      created = 1;
      createdIds.push(itemId);
    }

    // Emit events for each created item so agents can react
    if (eventBus && createdIds.length > 0) {
      for (const itemId of createdIds) {
        await eventBus.emit({
          connectorKind: "inbox",
          type: "inbox.item_created",
          tenantId,
          data: { itemId, source },
          timestamp: new Date(),
        }).catch(() => {}); // don't fail the workflow on event errors
      }
    }

    return {
      output: { created, source, itemIds: createdIds },
    };
  },
};

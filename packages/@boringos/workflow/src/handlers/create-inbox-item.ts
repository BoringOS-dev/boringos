import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * create-inbox-item block handler — stores data in the inbox.
 * Used in sync workflows to persist fetched data before agent processing.
 *
 * Config:
 *   - source: string — where the item came from (e.g., "gmail", "slack")
 *   - subject: string — item subject/title (supports templates)
 *   - body: string — item body/content (supports templates)
 *   - from: string — sender (supports templates)
 *   - items: array — if provided, creates one inbox item per array element
 *     Each element should have { subject, body?, from? }
 *
 * Requires "db" service.
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

    const source = (ctx.config.source as string) ?? "workflow";
    const tenantId = ctx.tenantId;
    let created = 0;

    // Batch mode — create from array (may arrive as JSON string from template resolution)
    let items: unknown = ctx.config.items;
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch { /* not JSON, treat as single */ }
    }
    if (Array.isArray(items) && items.length > 0) {
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

        await db.insert(inboxItems).values({
          id: generateId(),
          tenantId,
          source,
          subject: (entry.subject as string) ?? (entry.summary as string) ?? (entry.title as string) ?? "No subject",
          body: (entry.body as string) ?? (entry.snippet as string) ?? (entry.description as string) ?? null,
          from: (entry.from as string) ?? null,
          sourceId,
          metadata: entry,
        });
        created++;
      }
    } else {
      // Single item mode
      await db.insert(inboxItems).values({
        id: generateId(),
        tenantId,
        source,
        subject: (ctx.config.subject as string) ?? "No subject",
        body: (ctx.config.body as string) ?? null,
        from: (ctx.config.from as string) ?? null,
      });
      created = 1;
    }

    return {
      output: { created, source },
    };
  },
};

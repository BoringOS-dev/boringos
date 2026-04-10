import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

/**
 * for-each block handler — iterates over an array from a previous block's output
 * and collects results. Used for processing lists (emails, events, items).
 *
 * Config:
 *   - items: the array to iterate (usually a template like "{{fetch.messages}}")
 *     After template resolution, this should be a JSON string of an array or an actual array.
 *   - itemKey: key name for each item in output (default: "item")
 *
 * Output:
 *   - items: the original array
 *   - count: number of items
 *   - processed: true
 */
export const forEachHandler: BlockHandler = {
  types: ["for-each"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    let items: unknown[] = [];

    const rawItems = ctx.config.items;
    if (typeof rawItems === "string") {
      try {
        items = JSON.parse(rawItems);
      } catch {
        // Might be a single value — wrap in array
        items = rawItems ? [rawItems] : [];
      }
    } else if (Array.isArray(rawItems)) {
      items = rawItems;
    }

    return {
      output: {
        items,
        count: items.length,
        processed: true,
      },
    };
  },
};

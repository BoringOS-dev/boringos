import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

export const transformHandler: BlockHandler = {
  types: ["transform"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    // config.mappings — key-value pairs where values may contain template references
    // Templates are already resolved by the engine before reaching here
    const mappings = (ctx.config.mappings as Record<string, unknown>) ?? {};
    return {
      output: { ...mappings },
    };
  },
};

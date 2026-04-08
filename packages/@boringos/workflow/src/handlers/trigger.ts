import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

export const triggerHandler: BlockHandler = {
  types: ["trigger"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    // Trigger is the entry point — passes through config as output
    return {
      output: { ...ctx.config },
    };
  },
};

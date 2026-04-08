import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

export const delayHandler: BlockHandler = {
  types: ["delay"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    const ms = (ctx.config.durationMs as number) ?? (ctx.config.seconds as number ?? 0) * 1000;

    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    return {
      output: { delayed: true, durationMs: ms },
    };
  },
};

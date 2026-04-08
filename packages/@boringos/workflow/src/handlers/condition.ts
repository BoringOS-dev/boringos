import type { BlockHandler, BlockHandlerContext, BlockHandlerResult } from "../types.js";

export const conditionHandler: BlockHandler = {
  types: ["condition"],

  async execute(ctx: BlockHandlerContext): Promise<BlockHandlerResult> {
    // Evaluate a simple condition from config
    // config.field — the field to check from a prior block's output
    // config.operator — "equals", "not_equals", "contains", "truthy"
    // config.value — the value to compare against
    const { field, operator, value } = ctx.config as {
      field?: string;
      operator?: string;
      value?: unknown;
    };

    let fieldValue: unknown = field;

    // If field looks like a resolved template value, use it directly
    // Otherwise treat it as a literal
    const op = operator ?? "truthy";
    let result = false;

    switch (op) {
      case "equals":
        result = String(fieldValue) === String(value);
        break;
      case "not_equals":
        result = String(fieldValue) !== String(value);
        break;
      case "contains":
        result = String(fieldValue).includes(String(value));
        break;
      case "truthy":
        result = Boolean(fieldValue);
        break;
      default:
        result = Boolean(fieldValue);
    }

    return {
      output: { result, field: fieldValue, operator: op },
      selectedHandle: result ? "condition-true" : "condition-false",
    };
  },
};

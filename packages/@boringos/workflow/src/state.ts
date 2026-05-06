import type { ExecutionState, BlockState } from "./types.js";

export function createExecutionState(): ExecutionState {
  const blocks = new Map<string, BlockState>();

  return {
    get(blockId: string): BlockState | undefined {
      return blocks.get(blockId);
    },

    set(blockId: string, state: BlockState): void {
      blocks.set(blockId, state);
    },

    all(): Map<string, BlockState> {
      return new Map(blocks);
    },
  };
}

/**
 * Resolve template references like {{blockName.field}} against execution state.
 * Uses block names (not IDs) for readability in workflow definitions.
 */
export function resolveTemplate(
  template: string,
  state: ExecutionState,
  nameToId: Map<string, string>,
): string {
  // Block names commonly include hyphens (e.g. "create-task", "wake-replier").
  // The original `\w+` regex silently passed those through as literal text,
  // breaking any workflow template that referenced an upstream block by name.
  return template.replace(/\{\{([\w-]+)\.(\w+)\}\}/g, (_match, blockName: string, field: string) => {
    const blockId = nameToId.get(blockName);
    if (!blockId) return `{{${blockName}.${field}}}`;

    const blockState = state.get(blockId);
    if (!blockState?.output) return `{{${blockName}.${field}}}`;

    const value = blockState.output[field];
    if (value === undefined) return `{{${blockName}.${field}}}`;
    // Preserve arrays and objects as JSON strings so downstream handlers can parse them
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value);
  });
}

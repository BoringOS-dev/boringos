import type { MemoryProvider } from "./types.js";

export const nullMemory: MemoryProvider = {
  name: "null",

  skillMarkdown() {
    return null;
  },

  async remember() {
    return "";
  },

  async recall() {
    return [];
  },

  async prime() {
    return null;
  },

  async forget() {},

  async ping() {
    return true;
  },
};

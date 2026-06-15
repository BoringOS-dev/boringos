// SPDX-License-Identifier: AGPL-3.0-or-later
//
// @boringos/brain — the owned foundation-brain engine (docs/brain.md).
// Postgres-native, tenantId-scoped: embedder ladder, hybrid retrieval,
// typed graph, files-as-system-of-record mirror. The moat.

export { createBrainMemory } from "./provider.js";
export type { BrainMemoryConfig, DriveLike } from "./provider.js";

export { createIndexer } from "./indexer.js";
export type { BrainIndexer } from "./indexer.js";

export { searchHybrid, reinforce } from "./retrieval.js";
export type { SearchOptions } from "./retrieval.js";

export {
  createGraphWriter,
  createGraphReader,
  extractWikilinks,
  extractCitations,
  slugify,
} from "./graph.js";
export type {
  GraphWriter,
  GraphReader,
  GraphNode,
  TraversalResult,
  Citation,
} from "./graph.js";

export {
  nullEmbedder,
  createOpenAIEmbedder,
  resolveEmbedder,
  toVectorLiteral,
} from "./embedder.js";
export type { OpenAIEmbedderConfig } from "./embedder.js";

export { probeCapabilities, __resetCapabilityCache } from "./capability.js";

export { distill, isoWeekId } from "./distill.js";
export type { DistillDeps, DistillOptions, DistillResult } from "./distill.js";

export { curate, detectConflicts, splitOversized, OKF_VERSION } from "./curate.js";
export type { CurateDeps, CurateOptions, CurateReport, CurateFinding } from "./curate.js";

export { exportOkf } from "./okf.js";
export type { OkfExportResult } from "./okf.js";

export {
  renderFrontmatter,
  parseFrontmatter,
  hasConformantFrontmatter,
  withFrontmatter,
} from "./frontmatter.js";
export type { Frontmatter } from "./frontmatter.js";

export { chunkContent } from "./chunk.js";
export type { Chunk } from "./chunk.js";

export {
  isDailyNotePath,
  dailyDateStamp,
  fragmentMarker,
  renderFragmentBlock,
  parseDailyFragments,
  stripFragment,
  markFragmentPromoted,
  dailyNoteHeader,
} from "./daily.js";
export type { DailyFragment, FragmentKind } from "./daily.js";

export { EMBED_DIMS } from "./types.js";
export type {
  Embedder,
  BrainCapabilities,
  BrainHit,
  BrainEdge,
  IndexInput,
  MemoryScope,
} from "./types.js";

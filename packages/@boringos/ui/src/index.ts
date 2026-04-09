// Client (framework-agnostic, no React)
export { createBoringOSClient } from "./client.js";
export type {
  BoringOSClient,
  BoringOSClientConfig,
  TaskWithComments,
  ConnectorInfo,
  WorkflowInfo,
  HealthStatus,
} from "./client.js";

// React provider
export { BoringOSProvider, useClient } from "./provider.js";
export type { BoringOSProviderProps } from "./provider.js";

// React hooks
export {
  useAgents,
  useTasks,
  useTask,
  useRuns,
  useRuntimes,
  useApprovals,
  useConnectors,
  useProjects,
  useGoals,
  useOnboarding,
  useEvals,
  useInbox,
  useEntityRefs,
  useSearch,
  useHealth,
} from "./hooks.js";

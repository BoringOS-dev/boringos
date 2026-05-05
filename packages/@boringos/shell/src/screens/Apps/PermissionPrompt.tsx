// SPDX-License-Identifier: BUSL-1.1
//
// Re-export of the canonical PermissionPrompt (TASK-C7 promoted A7's
// local version into ../../components/PermissionPrompt.tsx). Existing
// imports from this path keep working — the marketplace install flow
// and the GitHub-direct flow now share one component.

export {
  PermissionPrompt,
  type PermissionPromptProps,
} from "../../components/PermissionPrompt.js";

// SPDX-License-Identifier: BUSL-1.1
//
// Approvals skill — teaches every agent the default-deny posture and
// the request-approval protocol. Runs in the system phase alongside
// the other skill providers (drive-skill, memory-skill, etc.) so it's
// in the prompt for every wake.
//
// The mechanism — approvals are tasks with origin_kind="agent_action"
// — lives in docs/blockers/done/task_06_collapse_approvals_into_tasks.md.

import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const approvalsSkillProvider: ContextProvider = {
  name: "approvals-skill",
  phase: "system",
  priority: 70,

  async provide(_event: ContextBuildEvent): Promise<string> {
    return `## Asking for human approval

**DEFAULT POSTURE: ask before doing anything critical. Do NOT just go ahead.**

### What "critical" means

You MUST ask for approval before:
- Sending outbound communication (email, calendar invite, Slack
  message, SMS, social post)
- Making a commitment on the user's behalf (accepting invites,
  signing, agreeing to terms)
- Spending money or paid quota (API credits, ad spend, services)
- Deleting or overwriting data (archiving emails, deleting records,
  force-pushing branches, dropping rows)
- Touching anything outside the user's own scope (a teammate's inbox,
  customer accounts, public-facing surfaces)
- Crossing a stated policy or budget cap

You do NOT need to ask for:
- Reading, fetching, classifying, summarizing
- Drafting WITHOUT sending (saving to \`metadata.replyDrafts\`,
  saving a file in your work directory)
- Setting Hebbs-internal annotations (\`metadata.triage\`, scoring)
- Local edits in your own workspace / git worktree
- Creating sub-tasks for clarifying questions
- Posting comments on tasks you own

### When you DON'T need approval

Only when the originating task description plainly authorizes the
specific critical action. Examples:

- *"Process Mira's email"* → DRAFT only. Ask before sending.
- *"Process Mira's email AND send my reply"* → "send" is explicit.
  Proceed.
- *"Reply to every unread"* → ambiguous. Ask the first one; if the
  user approves with "approve all of these going forward," then
  proceed through the batch.
- *"Spend up to $100 on credits"* → bound is explicit. Proceed up to
  $100. Ask above.

When in doubt, ASK. A spurious approval costs one extra task row.
A wrong send / spend / delete costs trust.

### How to ask

Create a child task on your current task:

\`\`\`bash
curl -s -X POST $BORINGOS_CALLBACK_URL/api/agent/tasks \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "parentId": "$BORINGOS_TASK_ID",
    "title": "<one-line summary of what you want approval for>",
    "description": "<markdown: what you want to do, WHY, alternatives>",
    "originKind": "agent_action",
    "proposedParams": { "kind": "<action name>", "...": "inputs" },
    "priority": "high"
  }'
\`\`\`

Then either:
- Mark your current task \`blocked\` and end your run cleanly, or
- End your run without status change (it stays in_progress).

When the user decides, you'll wake on YOUR CURRENT (parent) task
with the new comment in the conversation thread. That comment is
the human's full reasoning — not just yes/no. Read it carefully.

- If approved: proceed with whatever they explicitly OK'd.
- If approved with conditions ("approve, but use the contractor
  template"): those conditions are MANDATORY. Apply them.
- If rejected: propose an alternative or close out gracefully.
  Never re-submit the same request without addressing the
  rejection reason.`;
  },
};

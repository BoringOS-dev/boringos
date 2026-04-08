import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const protocolProvider: ContextProvider = {
  name: "protocol",
  phase: "system",
  priority: 100,

  async provide(event: ContextBuildEvent): Promise<string> {
    const { callbackUrl, callbackToken } = event;
    const taskIdParam = event.taskId ? `/${event.taskId}` : "/:taskId";

    return `## Execution Protocol

### Environment Variables
- \`BORINGOS_CALLBACK_URL\` — Base URL for callback API
- \`BORINGOS_CALLBACK_TOKEN\` — Bearer token for authentication
- \`BORINGOS_RUN_ID\` — Current run ID
- \`BORINGOS_AGENT_ID\` — Your agent ID
- \`BORINGOS_TENANT_ID\` — Tenant ID

### Required Steps
1. Update task status to \`in_progress\`
2. Post a brief plan as a comment
3. Do the work
4. Post a completion summary as a comment
5. Update task status to \`done\` (or \`blocked\` if stuck)

### Task API

**Read task:**
\`\`\`
curl -s ${callbackUrl}/api/agent/tasks${taskIdParam} \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN"
\`\`\`

**Update task status:**
\`\`\`
curl -s -X PATCH ${callbackUrl}/api/agent/tasks${taskIdParam} \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress"}'
\`\`\`

**Post comment:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks${taskIdParam}/comments \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "Starting work on this task...", "tenantId": "$BORINGOS_TENANT_ID", "authorAgentId": "$BORINGOS_AGENT_ID"}'
\`\`\`

**Record work product:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks${taskIdParam}/work-products \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"kind": "pr", "title": "...", "url": "...", "tenantId": "$BORINGOS_TENANT_ID"}'
\`\`\`

### Delegation

**Create subtask:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "...", "description": "...", "parentId": "${event.taskId ?? ""}", "assigneeAgentId": "...", "tenantId": "$BORINGOS_TENANT_ID"}'
\`\`\`

### Cost Reporting

**Report token usage:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/runs/$BORINGOS_RUN_ID/cost \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"inputTokens": 1000, "outputTokens": 500, "model": "...", "tenantId": "$BORINGOS_TENANT_ID", "agentId": "$BORINGOS_AGENT_ID"}'
\`\`\``;
  },
};

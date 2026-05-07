# Blocker — Agents discover their tools automatically (curl-only)

## The problem

Agents don't know what they can do.

When the Generic Email Replier was asked to "Send pricing reply to
Acme," it correctly recognized that sending an email is a critical
action and asked for approval (good — the approvals skill is
working). But after the user approved with conditions, **no email
was sent.** Reason: the agent had no idea that
`POST /api/connectors/actions/google/send_email` exists. It can
spawn Bash, it can curl arbitrary URLs, it has the bearer token —
but the URL isn't in its prompt. So it does nothing.

This generalizes. Every connector ships actions
(`ConnectorDefinition.actions`). Every plugin ships hooks. Every
installed app can register routes with `agentDocs`. None of these
flow into the agent prompt automatically. Agents only know the
two things wired by hand into the protocol provider: task CRUD
and comment posting.

That's a foundational gap. It will reappear for every connector
we add (Slack, Notion, Stripe), every app a user installs, every
plugin a tenant registers.

## The decision

Tools are **curl + good docs**, not a separate transport layer.

- **No MCP.** It's a transport for RPC the framework already exposes
  via HTTP. Adds a layer; explains nothing the agent doesn't already
  understand.
- **No custom CLI wrapper** (`boringos call ...`) — it would just
  be a thinner skin over curl. We'd have to teach the agent the
  binary's flags, which is more onboarding cost than teaching curl.
- **No tool-use API.** Claude Code subprocesses don't take a `tools`
  parameter; they read a system prompt and use Bash. Whatever we put
  in the prompt is what they have.

So: agents already have Bash. They already have curl. They already
have a bearer token in `$BORINGOS_CALLBACK_TOKEN`. The only thing
missing is **a generated catalog of every callable thing**, dropped
into the system prompt at every wake.

## What gets advertised

A unified "## Available tools" section in the system prompt,
emitted by a new context provider. Sections:

### 1. Connector actions
Read from `connectorRegistry.list()`. For each connector + action,
emit:

```markdown
### google.send_email — Send an email
Inputs:
- `to` (string, required) — recipient address
- `subject` (string, required)
- `body` (string, required) — plain text body

curl:
  curl -sS -X POST $BORINGOS_CALLBACK_URL/api/connectors/actions/google/send_email \
    -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"to": "x@y.com", "subject": "hi", "body": "hello"}'
```

The catalog is dynamic. When the user connects a new connector, the
next agent wake sees the new tools without code changes anywhere.

### 2. App-registered HTTP routes
Already exists via `api-catalog` provider, which calls each
registered app's `agentDocs(baseUrl)`. Keep it; just make sure the
new "Available tools" section nests under the same header so the
agent reads them as one surface.

### 3. Plugin webhook receivers (future)
Plugins can expose webhooks (`POST /webhooks/plugins/:name/:event`).
Most are inbound (external service → plugin), but a few might be
agent-callable. v1 punt: only advertise when a plugin explicitly
declares `agentCallableWebhooks: true`.

### 4. Inbox / drive / memory primitives
Already covered by their respective skill providers
(`memory-skill`, `drive-skill`). Cross-link from "Available tools"
so an agent reading the section sees pointers to the rest.

## Implementation

### Phase 1 — `connectorActionsCatalogProvider`

New file: `packages/@boringos/agent/src/providers/connector-actions-catalog.ts`.

```ts
export function createConnectorActionsCatalogProvider(deps: {
  connectorRegistry: ConnectorRegistry;
}): ContextProvider {
  return {
    name: "connector-actions-catalog",
    phase: "system",
    priority: 75, // right after approvals-skill (70)

    async provide(_event): Promise<string> {
      const lines = ["## Available tools — connector actions", ""];
      lines.push(
        "Each tool below is callable by curling the framework's " +
        "connector-actions endpoint. Your `$BORINGOS_CALLBACK_TOKEN` " +
        "authorizes you against the tenant's connector credentials. " +
        "Don't try to authenticate with the third party directly.",
        "",
      );
      const connectors = deps.connectorRegistry.list();
      for (const c of connectors) {
        if (c.actions.length === 0) continue;
        lines.push(`### ${c.name} (\`${c.kind}\`)`);
        for (const action of c.actions) {
          lines.push(`#### \`${c.kind}.${action.name}\` — ${action.description}`);
          if (Object.keys(action.inputs).length > 0) {
            lines.push("Inputs:");
            for (const [name, def] of Object.entries(action.inputs)) {
              const reqd = def.required ? " (required)" : "";
              lines.push(`- \`${name}\` (${def.type}${reqd}) — ${def.description}`);
            }
          }
          lines.push("");
          lines.push(curlSkeleton(c.kind, action.name, action.inputs));
          lines.push("");
        }
      }
      return lines.join("\n");
    },
  };
}
```

Helper `curlSkeleton(kind, action, inputs)` emits a copy-pasteable
curl with placeholder values matching the input types.

The provider needs the connector registry. Wire it into
`AgentEngineConfig` alongside the existing `apiCatalog`.

### Phase 2 — Approvals-skill update

Append to `approvalsSkillProvider`:

```md
### Executing an approved action

When you wake on a task and see a recent comment that starts with
`**Approved.**`, an agent_action child task you created is now
authorized. Find it in your subtasks (or use the approval comment's
context — the framework includes the proposed_params snapshot
inline). Apply any modifications the user noted in the comment,
then execute the action by curling the connector endpoint listed
under "Available tools."

If the user's comment changed a parameter (e.g., "send to
mira.arora@gmail.com instead"), use the modified value, not the
original `proposed_params`. The user's comment is authoritative
over the original request.

After execution, post a confirmation comment on the parent task
with what was sent, including the message id or other return
data from the action result.
```

### Phase 3 — Decision endpoint snapshots `proposed_params`

When the user approves an `agent_action` child, the comment that
lands on the parent currently contains only the user's text plus
"**Approved.**" prefix. The parent agent has to fetch the child
task to see what was actually approved.

Cheaper: include the child task's `proposed_params` snapshot in
the comment body. Modify `POST /tasks/:id/decision` in
`admin-routes.ts`:

```ts
const proposedSnapshot = task.proposedParams
  ? `\n\n_Action: \`${task.proposedParams.kind}\`. Parameters:_\n` +
    "```json\n" + JSON.stringify(task.proposedParams, null, 2) + "\n```"
  : "";

const commentBody =
  kind === "approve"
    ? `**Approved.**${userComment ? `\n\n${userComment}` : ""}${proposedSnapshot}`
    : `**Rejected.**${userComment ? `\n\n${userComment}` : ""}`;
```

Now the parent agent's next wake includes the comment in its
context — and the comment has the full action call to make. No
extra fetch.

## Files in scope

- `packages/@boringos/agent/src/providers/connector-actions-catalog.ts` — new
- `packages/@boringos/agent/src/providers/index.ts` — export the new provider
- `packages/@boringos/agent/src/engine.ts` — register it in the default pipeline
- `packages/@boringos/agent/src/types.ts` — add `connectorRegistry` to
  `AgentEngineConfig`
- `packages/@boringos/agent/src/providers/approvals-skill.ts` — append
  the executing-approved-actions section
- `packages/@boringos/core/src/boringos.ts` — pass `connectorRegistry`
  into the agent engine config
- `packages/@boringos/core/src/admin-routes.ts` — `proposed_params`
  snapshot in decision comments

## Test plan

1. **Catalog appears in the prompt.** Spawn any agent run. The
   `stdout_excerpt` should contain `Available tools — connector
   actions` and a `### google.send_email` block. Confirms the
   provider is wired and rendering.

2. **Connect a new connector mid-flight; new tools appear without
   restart.** (Skip — connectors are loaded at framework boot
   today; revisit when we add hot-reload.)

3. **End-to-end approval → send.**
   - User clicks Approve on an `agent_action` task whose parent
     has an agent assignee.
   - Decision endpoint posts a comment to the parent with the
     `proposed_params` snapshot inline.
   - Parent agent wakes, reads the comment, executes the curl
     call from the catalog, posts a confirmation comment with the
     Gmail message id.
   - Verify the email actually shows up in `in:sent`.

4. **Approve with modification.** User comments "send to
   different.address@gmail.com instead." Agent applies the change
   when constructing the curl body, sends to the new address.

## Why curl, not anything fancier

- **Zero new abstractions.** Bash + curl + bearer token = stuff the
  agent already understands from day-1 training.
- **Cheaper to teach.** Two paragraphs of skill markdown vs.
  a wrapper CLI binary that needs its own flags + error semantics.
- **Easier to debug.** When something fails, the agent sees a
  raw HTTP error code + body. We've watched agents recover from
  `401` already (the OAuth refresh case). They handle `400`s well
  too if the input shape is wrong.
- **Composes naturally.** The agent can chain: curl, parse jq,
  curl again, post comment with the result. No SDK to extend.
- **Survives every model upgrade.** Bash and curl will outlast
  any specific tool-call protocol.

## What's NOT in this task

- **MCP integration.** Explicitly declined. We have working RPC; we
  don't need a second transport layer to advertise it.
- **Custom `boringos` CLI binary.** Same reason — extra layer for
  no real ergonomics gain over curl.
- **Tool-use API integration.** Claude Code subprocesses spawn with
  Bash already; we don't pass a `tools` argument.
- **Schema validation server-side.** If the agent sends bad input,
  the connector returns a 400 with an error body. The agent reads
  it and tries again. Don't over-validate.
- **Per-tenant tool whitelisting / RBAC.** Worth doing eventually
  (some tenants don't want their agents calling `send_email`
  without per-message approval) but lives in
  `task_04_admin_settings_cron_workflow.md`, not here.

## Open questions

- **Catalog token cost.** Each connector adds ~200-500 tokens to
  every agent's system prompt. Slack alone has ~10 actions. With 5
  connectors connected the catalog could be 5K tokens. Acceptable
  for now (Sonnet/Haiku context windows); revisit if we add many
  more.
- **Conditional advertising.** Should we only advertise actions
  for connectors the tenant has actually connected? Yes — read
  from `connectors` table joined with `connectorRegistry.list()`,
  emit only the intersection. Otherwise an agent might try to
  call Slack on a tenant that hasn't connected it.
- **Rate-limiting / safety.** An agent in a loop calling
  `send_email` 100 times costs the user real money + reputation.
  Belongs in `task_04`'s budget enforcement layer, not here. v1
  relies on the approvals skill to gate this.

## Why this matters

Right now the framework has a beautiful approval system, a
beautiful task model, a beautiful per-task session — and an agent
that doesn't know it can send email. That's not a bug; it's a
design gap. Without unified tool discovery, every new connector,
plugin, or app requires hand-editing the system prompt to teach
agents about it. That doesn't scale beyond the first integration.

The framework's deal with the developer is supposed to be: write
your `ConnectorDefinition` once, the agents see it. We have the
data; we just need to project it into the prompt.

## Build order

1. `connectorActionsCatalogProvider` (new file + index export +
   engine registration + boringos.ts wire-up). Verify in stdout.
2. Update `approvalsSkillProvider` with the post-approval execution
   section.
3. Decision endpoint snapshots `proposed_params` in the comment.
4. End-to-end test: agent on parent task → asks → user approves →
   agent reads catalog + comment → curls send_email → confirmation
   in `in:sent` and as a comment on the parent.

Approx 120 lines total. Single PR.

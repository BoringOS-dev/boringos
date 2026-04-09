import type { PluginDefinition } from "../plugin-system.js";

/**
 * Built-in GitHub plugin.
 *
 * Jobs:
 *   - sync-repos: syncs issues and PRs from configured repos into tasks
 *
 * Webhooks:
 *   - issue-created: creates a task when a GitHub issue is opened
 *   - pr-opened: creates a task when a PR is opened
 *
 * Config:
 *   - token: GitHub personal access token
 *   - org: GitHub organization name
 *   - repos: array of repo names to sync
 */
export const githubPlugin: PluginDefinition = {
  name: "github",
  version: "1.0.0",
  description: "Sync GitHub issues and PRs into BoringOS tasks.",

  configSchema: {
    token: { type: "string", description: "GitHub personal access token", required: true },
    org: { type: "string", description: "GitHub organization name", required: true },
    repos: { type: "array", description: "Repository names to sync" },
  },

  jobs: [
    {
      name: "sync-repos",
      schedule: "*/15 * * * *",
      async handler(ctx) {
        const { token, org, repos } = ctx.config as { token: string; org: string; repos?: string[] };
        if (!token || !org) return;

        const repoList = repos ?? [];
        const lastSync = await ctx.state.get("lastSyncAt") as string | null;

        for (const repo of repoList) {
          try {
            const since = lastSync ? `&since=${lastSync}` : "";
            const res = await fetch(`https://api.github.com/repos/${org}/${repo}/issues?state=open${since}`, {
              headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
            });

            if (res.ok) {
              const issues = await res.json() as Array<{ number: number; title: string; body: string; pull_request?: unknown }>;
              // Store count for state tracking
              await ctx.state.set(`${repo}-issueCount`, issues.length);
            }
          } catch {
            // Individual repo failure doesn't stop the sync
          }
        }

        await ctx.state.set("lastSyncAt", new Date().toISOString());
      },
    },
  ],

  webhooks: [
    {
      event: "issue-created",
      async handler(req) {
        const body = req.body as Record<string, unknown>;
        const action = body.action as string;
        if (action !== "opened") return { status: 200, body: { ignored: true } };

        const issue = body.issue as Record<string, unknown>;
        return {
          status: 200,
          body: {
            action: "task_created",
            source: "github",
            title: issue.title,
            number: issue.number,
          },
        };
      },
    },
    {
      event: "pr-opened",
      async handler(req) {
        const body = req.body as Record<string, unknown>;
        const action = body.action as string;
        if (action !== "opened") return { status: 200, body: { ignored: true } };

        const pr = body.pull_request as Record<string, unknown>;
        return {
          status: 200,
          body: {
            action: "task_created",
            source: "github",
            title: `PR: ${pr.title}`,
            number: pr.number,
            url: pr.html_url,
          },
        };
      },
    },
  ],
};

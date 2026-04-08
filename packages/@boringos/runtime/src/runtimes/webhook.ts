import type { RuntimeModule, RuntimeExecutionContext, RuntimeExecutionResult, AgentRunCallbacks } from "../types.js";

export const webhookRuntime: RuntimeModule = {
  type: "webhook",

  skillMarkdown() {
    return "This agent runs via HTTP webhook invocation.";
  },

  async execute(ctx: RuntimeExecutionContext, callbacks: AgentRunCallbacks): Promise<RuntimeExecutionResult> {
    const config = ctx.config as Record<string, string | undefined>;
    const url = config.url;
    if (!url) {
      const err = new Error("webhook runtime requires a 'url' in config");
      callbacks.onError(err);
      return { exitCode: 1, errorMessage: err.message };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.authHeader ? { Authorization: config.authHeader } : {}),
        },
        body: JSON.stringify({
          runId: ctx.runId,
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          taskId: ctx.taskId,
          contextMarkdown: ctx.contextMarkdown,
          systemInstructions: ctx.systemInstructions,
          callbackUrl: ctx.callbackUrl,
          callbackToken: ctx.callbackToken,
        }),
      });

      const body = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (res.ok) {
        const sessionId = body.sessionId as string | undefined;
        callbacks.onComplete({ exitCode: 0, sessionId });
        return { exitCode: 0, sessionId, provider: "webhook" };
      } else {
        const msg = `Webhook returned ${res.status}: ${JSON.stringify(body)}`;
        callbacks.onError(new Error(msg));
        return { exitCode: 1, errorMessage: msg, provider: "webhook" };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      return { exitCode: 1, errorMessage: error.message };
    }
  },

  async testEnvironment(config: Record<string, unknown>) {
    const url = config.url as string | undefined;
    if (!url) {
      return {
        status: "fail" as const,
        checks: [{ code: "webhook_url_missing", level: "error" as const, message: "No webhook URL configured" }],
        testedAt: new Date().toISOString(),
      };
    }

    try {
      const res = await fetch(url, { method: "HEAD" });
      return {
        status: res.ok || res.status === 405 ? "pass" as const : "warn" as const,
        checks: [{
          code: "webhook_reachable",
          level: res.ok || res.status === 405 ? "info" as const : "warn" as const,
          message: `Webhook endpoint responded with ${res.status}`,
        }],
        testedAt: new Date().toISOString(),
      };
    } catch {
      return {
        status: "fail" as const,
        checks: [{ code: "webhook_unreachable", level: "error" as const, message: `Cannot reach ${url}` }],
        testedAt: new Date().toISOString(),
      };
    }
  },
};

import type { ContextProvider, ContextBuildEvent } from "../types.js";

/** Accepts either a static markdown string, or a function given the runtime callback URL. */
export type AgentDocs = string | ((callbackUrl: string) => string);

export interface ApiCatalogEntry {
  /** Mount path, e.g. "/api/crm" */
  path: string;
  /**
   * Markdown describing the endpoints under this mount. Reference the env
   * vars `$BORINGOS_TENANT_ID` / `$BORINGOS_CALLBACK_TOKEN` available in the
   * agent subprocess. Use the function form when you need to embed the
   * callback URL (it is only known at runtime).
   *
   * Apps typically compose this from per-route helpers so the docs stay
   * next to the handlers they describe.
   */
  agentDocs: AgentDocs;
}

/**
 * Emits a "## App APIs" section into the system prompt listing every mounted
 * sub-app's agent-facing endpoints. Populated from `app.route(path, router,
 * { agentDocs })` calls collected by the BoringOS builder.
 *
 * Accepts either a static array or a getter. The getter form is important
 * because apps commonly register routes inside `beforeStart` hooks that run
 * AFTER the agent engine is created — a snapshot would always be empty.
 */
export function createApiCatalogProvider(
  source: ApiCatalogEntry[] | (() => ApiCatalogEntry[]),
): ContextProvider {
  return {
    name: "api-catalog",
    phase: "system",
    priority: 110,

    async provide(event: ContextBuildEvent): Promise<string> {
      const entries = typeof source === "function" ? source() : source;
      if (entries.length === 0) return "";

      const sections = entries.map((entry) => {
        const docs = typeof entry.agentDocs === "function" ? entry.agentDocs(event.callbackUrl) : entry.agentDocs;
        return `### Mount: \`${entry.path}\`\n\n${docs}`;
      }).join("\n\n");

      return `## App APIs

The following endpoints are mounted by the running application. Use them to read and write app-specific data. All requests go to \`$BORINGOS_CALLBACK_URL\` + the paths shown below. Auth requirements vary by mount — the docs for each mount describe what headers/tokens it expects.

${sections}`;
    },
  };
}

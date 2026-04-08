import type { ContextProvider, ContextBuildEvent } from "../types.js";

export function createTenantGuidelinesProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "tenant-guidelines",
    phase: "system",
    priority: 20,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      try {
        const { eq, and } = await import("drizzle-orm");
        const { tenantSettings } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const rows = await db
          .select()
          .from(tenantSettings)
          .where(and(
            eq(tenantSettings.tenantId, event.tenantId),
            eq(tenantSettings.key, "base_instructions"),
          ))
          .limit(1);

        const value = rows[0]?.value;
        if (!value) return null;

        return `## Company Guidelines\n\n${value}`;
      } catch {
        return null;
      }
    },
  };
}

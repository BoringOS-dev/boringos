import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Records a tenant's approval for one app to read another app's
 * entities (or hold any other cross-app capability).
 *
 * Example: Accounts declares `entities.crm:read` in its manifest.
 * At install time the user is prompted ("Accounts needs to read CRM
 * deals to generate invoices — CRM is installed, approve this link?")
 * and on approval a row goes here.
 *
 * The capability column carries the full scope string (e.g.
 * `entities.crm:read`). The unique index prevents duplicates per
 * (tenant, source-app, target-app, capability) tuple.
 *
 * Enforcement of this approval lives in the SDK runtime checks
 * (separate work — see capabilities.md). The schema only records
 * what the tenant approved.
 */
export const tenantAppLinks = pgTable(
  "tenant_app_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceAppId: text("source_app_id").notNull(),
    targetAppId: text("target_app_id").notNull(),
    capability: text("capability").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqLink: uniqueIndex("tenant_app_links_uniq_idx").on(
      table.tenantId,
      table.sourceAppId,
      table.targetAppId,
      table.capability,
    ),
  }),
);

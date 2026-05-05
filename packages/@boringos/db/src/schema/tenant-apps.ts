import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Records which apps are installed in which tenants.
 *
 * The control plane (TASK-C5) writes a row here when an app is
 * installed and updates `status`/`updatedAt` through the lifecycle
 * (active → paused → uninstalling). The shell's InstallRuntime (A6)
 * is the in-memory mirror of this table for the UI's slot wiring.
 *
 * Status values are TEXT (not an enum) because the framework's other
 * status columns (agents.status, tasks.status) follow the same
 * convention — keeps migrations simpler when status sets evolve.
 *
 *   "active"        — installed and running
 *   "paused"        — disabled by the tenant; data retained, UI hidden
 *   "uninstalling"  — soft-uninstalled; data inside the retention window
 *
 * Capabilities is the resolved capability set granted at install time.
 * Manifest hash pins the bundle the tenant approved so update prompts
 * can detect when a new release diverges.
 */
export const tenantApps = pgTable(
  "tenant_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    appId: text("app_id").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull().default("active"),
    capabilities: jsonb("capabilities")
      .$type<string[]>()
      .notNull()
      .default([]),
    manifestHash: text("manifest_hash"),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantAppIdx: index("tenant_apps_tenant_app_idx").on(
      table.tenantId,
      table.appId,
    ),
  }),
);

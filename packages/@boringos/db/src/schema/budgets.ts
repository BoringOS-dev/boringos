import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";

export const budgetPolicies = pgTable("budget_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("tenant"),
  period: text("period").notNull().default("monthly"),
  limitCents: integer("limit_cents").notNull(),
  warnThresholdPct: integer("warn_threshold_pct").notNull().default(80),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgetIncidents = pgTable("budget_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  policyId: uuid("policy_id").notNull().references(() => budgetPolicies.id),
  agentId: uuid("agent_id").references(() => agents.id),
  type: text("type").notNull(),
  spentCents: integer("spent_cents").notNull(),
  limitCents: integer("limit_cents").notNull(),
  runId: uuid("run_id"),
  dismissed: text("dismissed").default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

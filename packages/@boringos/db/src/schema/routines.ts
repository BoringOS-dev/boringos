import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";
import { workflows } from "./workflows.js";

export const routines = pgTable("routines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id),
  workflowId: uuid("workflow_id").references(() => workflows.id),
  cronExpression: text("cron_expression").notNull(),
  timezone: text("timezone").default("UTC"),
  status: text("status").notNull().default("active"),
  concurrencyPolicy: text("concurrency_policy").notNull().default("skip_if_active"),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

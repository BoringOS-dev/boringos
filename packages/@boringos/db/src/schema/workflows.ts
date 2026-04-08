import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("user"),
  status: text("status").notNull().default("draft"),
  governingAgentId: uuid("governing_agent_id").references(() => agents.id, { onDelete: "set null" }),
  blocks: jsonb("blocks").$type<Record<string, unknown>[]>().notNull().default([]),
  edges: jsonb("edges").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

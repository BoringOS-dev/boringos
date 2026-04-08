import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { agents } from "./agents.js";

export const companySkills = pgTable("company_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sourceType: text("source_type").notNull(),
  sourceConfig: jsonb("source_config").$type<Record<string, unknown>>().notNull().default({}),
  trustLevel: text("trust_level").notNull().default("markdown_only"),
  syncStatus: text("sync_status").notNull().default("pending"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  fileInventory: jsonb("file_inventory").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentSkills = pgTable("agent_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  skillId: uuid("skill_id").notNull().references(() => companySkills.id),
  state: text("state").notNull().default("active"),
  syncMode: text("sync_mode").notNull().default("auto"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

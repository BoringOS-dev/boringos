import { pgTable, uuid, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const driveFiles = pgTable("drive_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  path: text("path").notNull(),
  filename: text("filename").notNull(),
  format: text("format"),
  size: integer("size").notNull().default(0),
  hash: text("hash"),
  syncedToMemory: boolean("synced_to_memory").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const driveSkillRevisions = pgTable("drive_skill_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  content: text("content").notNull(),
  changedBy: text("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

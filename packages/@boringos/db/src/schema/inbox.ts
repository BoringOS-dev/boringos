import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const inboxItems = pgTable("inbox_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assigneeUserId: text("assignee_user_id"),
  source: text("source").notNull(),
  sourceId: text("source_id"),
  subject: text("subject").notNull(),
  body: text("body"),
  from: text("from"),
  status: text("status").notNull().default("unread"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  linkedTaskId: uuid("linked_task_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * When status='snoozed', the wall-clock at which the framework's
   * snooze ticker should flip the row back to 'unread'. NULL when
   * the row isn't snoozed.
   */
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

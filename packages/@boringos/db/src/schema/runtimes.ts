import { pgTable, uuid, text, timestamp, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const runtimes = pgTable(
  "runtimes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    model: text("model"),
    status: text("status").notNull().default("unchecked"),
    healthResult: jsonb("health_result").$type<Record<string, unknown>>(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantNameUq: uniqueIndex("runtimes_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

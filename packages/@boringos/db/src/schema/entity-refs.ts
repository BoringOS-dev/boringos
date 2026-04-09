import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const entityReferences = pgTable(
  "entity_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index("entity_refs_entity_idx").on(table.entityType, table.entityId),
    refIdx: index("entity_refs_ref_idx").on(table.refType, table.refId),
  }),
);

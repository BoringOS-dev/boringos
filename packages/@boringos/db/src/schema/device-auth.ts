import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const cliAuthChallenges = pgTable("cli_auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  status: text("status").notNull().default("pending"),
  sessionToken: text("session_token"),
  userId: text("user_id"),
  tenantId: uuid("tenant_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

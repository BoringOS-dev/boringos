import { betterAuth } from "better-auth";
import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";

export interface AuthSetupConfig {
  secret: string;
  baseUrl: string;
  db: Db;
}

/**
 * Bootstrap Better Auth tables (idempotent).
 * Better Auth needs these tables to manage users and sessions.
 */
export async function bootstrapAuthTables(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      scope TEXT,
      id_token TEXT,
      password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth_verifications (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_tenants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Create the Better Auth instance.
 * This handles login, signup, session management.
 */
export function createAuth(config: AuthSetupConfig) {
  const auth = betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    database: {
      type: "postgres",
      // Better Auth uses its own table names; we bootstrapped them above
    } as any, // Better Auth's type expects a connection, but we handle tables ourselves
    emailAndPassword: {
      enabled: true,
    },
  });

  return auth;
}

/**
 * Session validation middleware helper.
 * Validates the session cookie/token and returns user info.
 */
export async function validateSession(
  db: Db,
  sessionToken: string,
): Promise<{ userId: string; tenantId: string } | null> {
  const now = new Date();

  // Query session directly from our bootstrapped tables
  const result = await db.execute(sql`
    SELECT s.user_id, ut.tenant_id
    FROM auth_sessions s
    JOIN user_tenants ut ON ut.user_id = s.user_id
    WHERE s.token = ${sessionToken}
      AND s.expires_at > ${now.toISOString()}
    LIMIT 1
  `);

  const rows = result as unknown as Array<{ user_id: string; tenant_id: string }>;
  if (!rows[0]) return null;

  return { userId: rows[0].user_id, tenantId: rows[0].tenant_id };
}

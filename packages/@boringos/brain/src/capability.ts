// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runtime capability probe. The migrator (db/src/migrate.ts) tries to
// add the pgvector tier defensively; the engine asks Postgres what
// actually landed and picks its retrieval path accordingly. Cached
// per engine instance — capabilities don't change without a restart
// (the migrator re-checks on every boot).

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { BrainCapabilities } from "./types.js";

let cached: BrainCapabilities | null = null;

export async function probeCapabilities(db: Db): Promise<BrainCapabilities> {
  if (cached) return cached;
  cached = await detect(db);
  return cached;
}

/** Test-only: forget the cached probe so a fresh DB re-detects. */
export function __resetCapabilityCache(): void {
  cached = null;
}

async function detect(db: Db): Promise<BrainCapabilities> {
  let hasVector = false;
  let hasTrgm = false;

  // The embedding column only exists when the migrator successfully
  // ran `CREATE EXTENSION vector` (embedded Postgres has no pgvector).
  // Probing for the COLUMN — not just the extension — is the correct
  // gate: it's the column the queries reference, and it's only there
  // when the whole vector tier came up.
  try {
    const rows = (await db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'brain__memories' AND column_name = 'embedding'
        ) AS has_vector,
        EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
        ) AS has_trgm
    `)) as unknown as Array<{ has_vector: boolean; has_trgm: boolean }>;
    hasVector = rows[0]?.has_vector === true;
    hasTrgm = rows[0]?.has_trgm === true;
  } catch {
    // If the probe itself fails, assume the floor — never crash boot.
    hasVector = false;
    hasTrgm = false;
  }

  return { hasVector, hasTrgm };
}

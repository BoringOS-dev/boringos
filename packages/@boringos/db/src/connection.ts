import { existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";
import type { DatabaseConfig } from "./types.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConnection {
  db: Db;
  close(): Promise<void>;
}

export async function createDatabase(config: DatabaseConfig): Promise<DatabaseConnection> {
  if ("url" in config) {
    const client = postgres(config.url);
    const db = drizzle(client, { schema });
    return {
      db,
      async close() {
        await client.end();
      },
    };
  }

  // Embedded Postgres
  const EmbeddedPostgres = (await import("embedded-postgres")).default;
  const dataDir = config.dataDir ?? "./.data/postgres";
  const port = config.port ?? 5433;

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "boringos",
    password: "boringos",
    port,
    persistent: true,
  });

  const alreadyInitialised = existsSync(join(dataDir, "PG_VERSION"));
  if (!alreadyInitialised) {
    await pg.initialise();
  }
  await pg.start();
  await pg.createDatabase("boringos").catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
  });

  const url = `postgres://boringos:boringos@127.0.0.1:${port}/boringos`;
  const client = postgres(url);
  const db = drizzle(client, { schema });

  return {
    db,
    async close() {
      await client.end();
      await pg.stop();
    },
  };
}

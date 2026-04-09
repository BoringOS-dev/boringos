import { createHash } from "node:crypto";
import { extname, basename } from "node:path";
import type { StorageBackend } from "./types.js";

export interface DriveManagerDeps {
  storage: StorageBackend;
  db: unknown;
  memory?: { remember(content: string, meta?: { entityId?: string; tags?: string[] }): Promise<string> } | null;
  tenantId: string;
}

export interface DriveManager {
  write(path: string, content: string | Uint8Array): Promise<DriveFileRecord>;
  read(path: string): Promise<string>;
  list(prefix?: string): Promise<DriveFileRecord[]>;
  remove(path: string): Promise<void>;
  getDriveSkill(): Promise<string | null>;
  updateDriveSkill(content: string, changedBy?: string): Promise<void>;
  getDriveSkillRevisions(): Promise<Array<{ id: string; changedBy: string | null; createdAt: Date }>>;
}

export interface DriveFileRecord {
  path: string;
  filename: string;
  format: string | null;
  size: number;
  hash: string;
  syncedToMemory: boolean;
}

export function createDriveManager(deps: DriveManagerDeps): DriveManager {
  const { storage, tenantId } = deps;

  // Lazy imports to avoid circular dependency issues
  async function getDb() {
    const { eq, and, desc } = await import("drizzle-orm");
    const { driveFiles, driveSkillRevisions } = await import("@boringos/db");
    const { generateId } = await import("@boringos/shared");
    return { db: deps.db as import("@boringos/db").Db, eq, and, desc, driveFiles, driveSkillRevisions, generateId };
  }

  function computeHash(content: string | Uint8Array): string {
    const data = typeof content === "string" ? Buffer.from(content) : content;
    return createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  function getFormat(path: string): string | null {
    const ext = extname(path).toLowerCase();
    return ext ? ext.slice(1) : null;
  }

  const TEXT_FORMATS = new Set(["md", "txt", "json", "yaml", "yml", "csv", "xml", "html"]);

  return {
    async write(path: string, content: string | Uint8Array): Promise<DriveFileRecord> {
      const tenantPath = `${tenantId}/${path}`;
      await storage.write(tenantPath, content);

      const size = typeof content === "string" ? Buffer.byteLength(content) : content.length;
      const hash = computeHash(content);
      const format = getFormat(path);
      const filename = basename(path);

      const { db, eq, and, driveFiles, generateId } = await getDb();

      // Upsert file record
      const existing = await db.select().from(driveFiles).where(
        and(eq(driveFiles.tenantId, tenantId), eq(driveFiles.path, path)),
      ).limit(1);

      if (existing[0]) {
        await db.update(driveFiles).set({ size, hash, format, updatedAt: new Date() }).where(eq(driveFiles.id, existing[0].id));
      } else {
        await db.insert(driveFiles).values({ id: generateId(), tenantId, path, filename, format, size, hash });
      }

      // Sync to memory if text-based
      let syncedToMemory = false;
      if (deps.memory && format && TEXT_FORMATS.has(format) && typeof content === "string") {
        try {
          await deps.memory.remember(content.slice(0, 2000), { entityId: tenantId, tags: ["drive", path] });
          syncedToMemory = true;
          if (existing[0]) {
            await db.update(driveFiles).set({ syncedToMemory: true }).where(eq(driveFiles.id, existing[0].id));
          }
        } catch { /* memory sync failure is non-fatal */ }
      }

      return { path, filename, format, size, hash, syncedToMemory };
    },

    async read(path: string): Promise<string> {
      return storage.readText(`${tenantId}/${path}`);
    },

    async list(prefix?: string): Promise<DriveFileRecord[]> {
      const { db, eq, driveFiles } = await getDb();
      const rows = await db.select().from(driveFiles).where(eq(driveFiles.tenantId, tenantId));
      let filtered = rows;
      if (prefix) filtered = rows.filter((r) => r.path.startsWith(prefix));
      return filtered.map((r) => ({
        path: r.path,
        filename: r.filename,
        format: r.format,
        size: r.size,
        hash: r.hash ?? "",
        syncedToMemory: r.syncedToMemory,
      }));
    },

    async remove(path: string): Promise<void> {
      await storage.delete(`${tenantId}/${path}`);
      const { db, eq, and, driveFiles } = await getDb();
      await db.delete(driveFiles).where(and(eq(driveFiles.tenantId, tenantId), eq(driveFiles.path, path)));
    },

    async getDriveSkill(): Promise<string | null> {
      try {
        return await storage.readText(`${tenantId}/.drive-skill.md`);
      } catch {
        return null;
      }
    },

    async updateDriveSkill(content: string, changedBy?: string): Promise<void> {
      // Save revision of current skill
      const current = await this.getDriveSkill();
      if (current) {
        const { db, driveSkillRevisions, generateId } = await getDb();
        await db.insert(driveSkillRevisions).values({
          id: generateId(),
          tenantId,
          content: current,
          changedBy: changedBy ?? null,
        });
      }

      // Write new skill
      await storage.write(`${tenantId}/.drive-skill.md`, content);
    },

    async getDriveSkillRevisions(): Promise<Array<{ id: string; changedBy: string | null; createdAt: Date }>> {
      const { db, eq, desc, driveSkillRevisions } = await getDb();
      const rows = await db.select().from(driveSkillRevisions)
        .where(eq(driveSkillRevisions.tenantId, tenantId))
        .orderBy(desc(driveSkillRevisions.createdAt))
        .limit(20);
      return rows.map((r) => ({ id: r.id, changedBy: r.changedBy, createdAt: r.createdAt }));
    },
  };
}

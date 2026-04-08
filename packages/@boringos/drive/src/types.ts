import type { Identifiable, TenantScoped, Timestamped, SkillProvider } from "@boringos/shared";

// ── StorageBackend — pluggable file storage ──────────────────────────────────

export interface StorageBackend extends SkillProvider {
  readonly name: string;

  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix?: string): Promise<FileEntry[]>;
  move(from: string, to: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
}

// ── Supporting types ─────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface FileStat {
  path: string;
  size: number;
  mimeType?: string;
  hash?: string;
  modifiedAt: Date;
}

export interface DriveFile extends Identifiable, TenantScoped, Timestamped {
  path: string;
  filename: string;
  format: string | null;
  size: number;
  hash: string | null;
  syncedToMemory: boolean;
}

export interface DriveConfig {
  root: string;
  defaultFolders?: string[];
}

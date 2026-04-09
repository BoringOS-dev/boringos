export type {
  StorageBackend,
  FileEntry,
  FileStat,
  DriveFile,
  DriveConfig,
} from "./types.js";

export { createLocalStorage, scaffoldDrive } from "./local.js";

export { createDriveManager } from "./manager.js";
export type { DriveManager, DriveManagerDeps, DriveFileRecord } from "./manager.js";

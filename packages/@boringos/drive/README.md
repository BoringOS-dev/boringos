# @boringos/drive

File storage abstraction for BoringOS with path traversal protection, file indexing, and memory sync.

## Install

```bash
npm install @boringos/drive
```

## Usage

```typescript
import {
  createLocalStorage,
  scaffoldDrive,
  createDriveManager,
} from "@boringos/drive";

// Create a local filesystem backend
const storage = createLocalStorage({ root: "/data/drive" });

// Scaffold default folder structure for a tenant
await scaffoldDrive("/data/drive", "tenant_123");

// Basic storage operations
await storage.write("docs/notes.md", Buffer.from("# Notes\nHello"));
const content = await storage.readText("docs/notes.md");
const files = await storage.list("docs/");
const exists = await storage.exists("docs/notes.md");
const stat = await storage.stat("docs/notes.md");

// DriveManager: storage + DB indexing + memory sync
const drive = createDriveManager({
  storage,
  db,
  memory, // optional: auto-syncs text files to memory
  tenantId: "tenant_123",
});
```

## API Reference

### Factories

| Export | Description |
|---|---|
| `createLocalStorage({ root })` | Filesystem backend with path traversal protection |
| `scaffoldDrive(root, tenantId)` | Create default folder structure |
| `createDriveManager(deps)` | Full manager with DB indexing and memory sync |

### `StorageBackend` Interface

| Method | Description |
|---|---|
| `read(path)` | Read file as Buffer |
| `readText(path)` | Read file as string |
| `write(path, data)` | Write file |
| `delete(path)` | Delete file |
| `exists(path)` | Check if file exists |
| `list(prefix?)` | List files in directory |
| `move(from, to)` | Move/rename file |
| `stat(path)` | Get file metadata (size, modified) |

### Types

`StorageBackend`, `FileEntry`, `FileStat`, `DriveFile`, `DriveConfig`, `DriveManager`, `DriveManagerDeps`, `DriveFileRecord`

## Part of [BoringOS](https://github.com/BoringOS-dev/boringos)

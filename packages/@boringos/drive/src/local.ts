import { readFile, writeFile, unlink, stat, readdir, rename, mkdir } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { existsSync } from "node:fs";
import type { StorageBackend, FileEntry, FileStat } from "./types.js";
import { sanitizePath } from "@boringos/shared";

export function createLocalStorage(config: { root: string }): StorageBackend {
  const root = config.root;

  function resolve(path: string): string {
    return sanitizePath(root, path);
  }

  const backend: StorageBackend = {
    name: "local",

    async read(path: string): Promise<Uint8Array> {
      return readFile(resolve(path));
    },

    async readText(path: string): Promise<string> {
      return readFile(resolve(path), "utf8");
    },

    async write(path: string, content: string | Uint8Array): Promise<void> {
      const fullPath = resolve(path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },

    async delete(path: string): Promise<void> {
      await unlink(resolve(path));
    },

    async exists(path: string): Promise<boolean> {
      return existsSync(resolve(path));
    },

    async list(prefix?: string): Promise<FileEntry[]> {
      const dir = prefix ? resolve(prefix) : root;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.map((entry) => ({
          path: relative(root, join(dir, entry.name)),
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch {
        return [];
      }
    },

    async move(from: string, to: string): Promise<void> {
      const toPath = resolve(to);
      await mkdir(dirname(toPath), { recursive: true });
      await rename(resolve(from), toPath);
    },

    async stat(path: string): Promise<FileStat | null> {
      try {
        const s = await stat(resolve(path));
        return {
          path,
          size: s.size,
          modifiedAt: s.mtime,
        };
      } catch {
        return null;
      }
    },

    skillMarkdown() {
      return DRIVE_SKILL;
    },
  };

  return backend;
}

export async function scaffoldDrive(root: string, tenantId: string): Promise<void> {
  const tenantRoot = join(root, tenantId);
  const dirs = ["projects", "agents", "tasks", "shared", "inbox"];

  for (const dir of dirs) {
    await mkdir(join(tenantRoot, dir), { recursive: true });
  }

  const skillPath = join(tenantRoot, ".drive-skill.md");
  if (!existsSync(skillPath)) {
    await writeFile(skillPath, DRIVE_SKILL, "utf8");
  }
}

const DRIVE_SKILL = `# Drive — File Organization

## Folder Structure

\`\`\`
{tenantId}/
├── projects/          # Project-specific files
├── agents/            # Agent workspace files
├── tasks/             # Task deliverables organized by identifier
│   └── {identifier}/  # e.g., tasks/AR-001/
├── shared/            # Shared resources across agents
└── inbox/             # Unprocessed uploads
\`\`\`

## Rules

1. Task deliverables go in \`tasks/{identifier}/\`
2. Shared resources go in \`shared/\`
3. Uploaded files land in \`inbox/\` and get organized by agents
4. Use descriptive filenames: \`quarterly-report-q2.md\` not \`report.md\`
5. Prefer markdown for documents, keep binary files in appropriate subdirectories
`;

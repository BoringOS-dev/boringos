// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OKF bundle export (docs/brain-okf-compat.md U-OKF-5). A scope's memory
// tree IS an OKF bundle — a directory of markdown concepts. Export
// (1) ensures it's curated (frontmatter + per-dir index.md + okf_version,
// via the idempotent curator), (2) validates OKF §9 conformance over the
// whole tree, and (3) writes a bundle-level log.md from the weekly
// syntheses. Returns a manifest. The tree is the bundle — no copy needed.

import { curate, type CurateDeps } from "./curate.js";
import { hasConformantFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { OKF_VERSION } from "./curate.js";
import type { DriveLike } from "./provider.js";

const RESERVED = new Set(["index.md", "log.md", "MEMORY.md"]);

export interface OkfExportResult {
  bundleRoot: string;
  fileCount: number;
  conformant: boolean;
  okfVersion: string | null;
  violations: string[];
  logWritten: boolean;
}

export async function exportOkf(deps: CurateDeps, opts: {
  tenantId: string;
  scope?: "tenant" | "user";
  ownerUserId?: string;
  now: Date;
  writeLog?: boolean;
}): Promise<OkfExportResult> {
  const scope = opts.scope ?? "tenant";
  const scopeRoot = scope === "tenant" ? "shared" : `users/${opts.ownerUserId}`;
  if (scope === "user" && !opts.ownerUserId) throw new Error("exportOkf: user scope requires ownerUserId");
  const memRoot = `${scopeRoot}/memory`;

  // 1. Ensure the tree is a conformant, indexed bundle (idempotent).
  await curate(deps, { tenantId: opts.tenantId, scope, ownerUserId: opts.ownerUserId, now: opts.now });

  // 2. Validate OKF §9 over the WHOLE tree (incl. 60-daily, MEMORY.md).
  const all = await walkAll(deps.drive, opts.tenantId, memRoot);
  const mdFiles = all.filter((r) => r.endsWith(".md"));
  const violations: string[] = [];
  for (const rel of mdFiles) {
    const base = rel.split("/").pop() ?? "";
    if (RESERVED.has(base)) continue; // reserved files carry no frontmatter
    const content = (await read(deps.drive, opts.tenantId, rel)) ?? "";
    if (!content.trim()) continue;
    if (!hasConformantFrontmatter(content)) violations.push(rel);
  }

  // 3. okf_version from the root index.md.
  const rootIdx = (await read(deps.drive, opts.tenantId, `${memRoot}/index.md`)) ?? "";
  const okfVersion = (rootIdx.match(/okf_version:\s*"?([0-9.]+)"?/) ?? [])[1] ?? null;

  // 4. Bundle-level log.md (OKF §7) from weekly syntheses, newest-first.
  let logWritten = false;
  if (opts.writeLog !== false) {
    const weeklies = mdFiles
      .filter((r) => /\/70-weekly\/[^/]+\.md$/.test(r))
      .sort()
      .reverse();
    if (weeklies.length > 0) {
      const entries: string[] = [];
      for (const w of weeklies) {
        const { fm } = parseFrontmatter((await read(deps.drive, opts.tenantId, w)) ?? "");
        const date = typeof fm.timestamp === "string" ? fm.timestamp.slice(0, 10) : (w.match(/(\d{4})-W(\d{2})/) ? "" : "");
        const day = date || opts.now.toISOString().slice(0, 10);
        entries.push(`## ${day}\n* **Synthesis**: [${(fm.title as string) || w}](/${w})`);
      }
      await deps.drive.write(
        `${opts.tenantId}/${memRoot}/log.md`,
        `# Directory Update Log\n\n${entries.join("\n\n")}\n`,
      );
      logWritten = true;
    }
  }

  return {
    bundleRoot: memRoot,
    fileCount: mdFiles.length,
    conformant: violations.length === 0 && okfVersion === OKF_VERSION,
    okfVersion,
    violations,
    logWritten,
  };
}

async function read(drive: DriveLike, tenantId: string, rel: string): Promise<string | null> {
  try {
    if (!(await drive.exists(`${tenantId}/${rel}`))) return null;
    return await drive.readText(`${tenantId}/${rel}`);
  } catch {
    return null;
  }
}

async function walkAll(drive: DriveLike, tenantId: string, relPrefix: string): Promise<string[]> {
  const out: string[] = [];
  const HARD_CAP = 5000;
  async function walk(prefix: string): Promise<void> {
    if (out.length >= HARD_CAP) return;
    let entries: Array<{ path: string; name: string; isDirectory: boolean }>;
    try {
      entries = await drive.list(prefix);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= HARD_CAP) break;
      if (e.isDirectory) await walk(e.path);
      else out.push(e.path.startsWith(`${tenantId}/`) ? e.path.slice(tenantId.length + 1) : e.path);
    }
  }
  await walk(`${tenantId}/${relPrefix}`);
  return out;
}

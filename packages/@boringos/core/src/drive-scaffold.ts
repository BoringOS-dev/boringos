// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drive scaffolding — seeds the "company brain" file structure at
// tenant create and at user-signup so the agent has something to read
// on its very first wake, and the dashboard `/api/admin/drive/list`
// shows the templates immediately (instead of an empty tenant).
//
// Both functions route through `DriveManager.write` (not raw
// `storage.write`) so every scaffolded file lands in BOTH:
//   - the filesystem (`./.data/drive/<tenantId>/...`), and
//   - the `driveFiles` Postgres index that powers the dashboard
// in one call. Previously the user-scope scaffold went directly to
// the filesystem, so signup templates were invisible to the dashboard.
//
// Idempotent + best-effort: pre-existing files are skipped, failures
// don't block signup or tenant create. See `docs/drive_issues.md` #1
// and #4 (scaffold-bypass slice) for the bugs this closes.

import type { Db } from "@boringos/db";
import { createDriveManager } from "@boringos/drive";
import type { StorageBackend } from "@boringos/drive";

export interface ScaffoldDeps {
  db: Db;
  drive: StorageBackend;
}

// Memory tree v2 (docs/brain.md §4.5). Numbered type folders give a
// deterministic read priority; the daily note is the append-only
// landing zone that the curator promotes into the durable folders.
const SHARED_MEMORY_TEMPLATE = `# Shared memory

Index + pointers, <200 lines. Tenant-canonical truth. Detail lives in
the numbered folders below; this file just points at it.

## Layout

- \`10-domains/\`   canonical facts, one file per area — every fact ends with (src: …)
- \`20-decisions/\` dated, who + why
- \`30-people/\`    who does what, who to ask
- \`40-operations/\` runbooks, how-tos
- \`60-daily/\`     append-only landing zone (remembered facts + run checkpoints)
- \`70-weekly/\`    weekly synthesis
- \`99-archive/\`   superseded facts, never deleted

## Active state

_Tenant-wide watch items, in-flight approvals._

## Standing rules

_One-liners with pointers to \`20-decisions/<topic>.md\`._

## Known entities

_Stable facts about customers, vendors, projects.
Pointers to \`10-domains/<entity>.md\`. Use [[wikilinks]] to wire the graph._
`;

function userPreferencesTemplate(displayName: string): string {
  return (
    `# Preferences — ${displayName}\n\n` +
    `This file captures **your** rules of engagement with the agent.\n` +
    `You can edit it directly — the agent reads it on every wake.\n\n` +
    `## Communication style\n\n` +
    `_e.g. "prefer terse responses, no preamble", "always cite sources"_\n\n` +
    `## Workflow preferences\n\n` +
    `_e.g. "ask before sending email", "draft commits with no co-authors"_\n\n` +
    `## What to remember about me\n\n` +
    `_e.g. "I work on a CRM product called Acme", "my timezone is IST"_\n\n` +
    `## Hard rules\n\n` +
    `_e.g. "never bypass code review", "do not auto-merge"_\n`
  );
}

function userMemoryTemplate(displayName: string): string {
  return (
    `# Memory index — ${displayName}\n\n` +
    `Index + pointers, <200 lines. What I know about ${displayName}, kept\n` +
    `brief. Detail lives in the numbered folders; this file points at it.\n\n` +
    `## Layout\n\n` +
    `- \`10-domains/\`   canonical facts, one file per area — facts end with (src: …)\n` +
    `- \`20-decisions/\` dated, who + why\n` +
    `- \`40-operations/\` runbooks, how-tos\n` +
    `- \`60-daily/\`     append-only landing zone (remembered facts + run checkpoints)\n` +
    `- \`70-weekly/\`    weekly synthesis\n` +
    `- \`99-archive/\`   superseded facts, never deleted\n\n` +
    `## Active state\n\n` +
    `_Watch items, current blockers, in-flight approvals._\n\n` +
    `## Standing rules\n\n` +
    `_One-liners with pointers to \`20-decisions/<topic>.md\`._\n\n` +
    `## Known entities\n\n` +
    `_Stable facts about people, companies, projects.\n` +
    `Pointers to \`10-domains/<entity>.md\`. Use [[wikilinks]] to wire the graph._\n`
  );
}

/**
 * Seed the tenant-wide `shared/memory/MEMORY.md` template at tenant
 * create. Without this, `shared/memory/` doesn't exist on disk until
 * the first agent decides to write there — and even when one does,
 * the dashboard never sees it because raw `drive.write` bypasses the
 * `driveFiles` index. Routes through `DriveManager.write` so both
 * the filesystem and the index are updated in one call.
 *
 * Idempotent: pre-existing file is skipped.
 * Best-effort: errors are swallowed so tenant creation is never
 * blocked on memory scaffolding.
 */
export async function scaffoldTenantSharedMemory(
  deps: ScaffoldDeps,
  tenantId: string,
): Promise<void> {
  const path = "shared/memory/MEMORY.md";
  try {
    if (await deps.drive.exists(`${tenantId}/${path}`)) return;
    const manager = createDriveManager({
      storage: deps.drive,
      db: deps.db,
      tenantId,
    });
    await manager.write(path, SHARED_MEMORY_TEMPLATE);
  } catch {
    /* shared-scope scaffold is best-effort */
  }
}

/**
 * Seed a user's `preferences.md` + `memory/MEMORY.md` when they're
 * linked to a tenant (typically at signup or invite-accept). Same
 * indexed-write path as the shared-scope scaffold so the files
 * appear in `/api/admin/drive/list`.
 *
 * Idempotent: pre-existing files are skipped.
 * Best-effort: signup must never block on memory scaffolding.
 */
export async function scaffoldUserMemory(
  deps: ScaffoldDeps,
  tenantId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  const manager = createDriveManager({
    storage: deps.drive,
    db: deps.db,
    tenantId,
  });

  const prefPath = `users/${userId}/preferences.md`;
  const memPath = `users/${userId}/memory/MEMORY.md`;

  try {
    if (!(await deps.drive.exists(`${tenantId}/${prefPath}`))) {
      await manager.write(prefPath, userPreferencesTemplate(displayName));
    }
  } catch {
    /* preferences scaffold is best-effort */
  }

  try {
    if (!(await deps.drive.exists(`${tenantId}/${memPath}`))) {
      await manager.write(memPath, userMemoryTemplate(displayName));
    }
  } catch {
    /* memory scaffold is best-effort */
  }
}

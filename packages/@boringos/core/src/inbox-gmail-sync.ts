// SPDX-License-Identifier: BUSL-1.1
//
// Hebbs → Gmail mirror for inbox state changes.
//
// When a user archives / reads / unreads / snoozes an inbox item that
// originated in Gmail, mirror the action by adding/removing labels on
// the underlying Gmail message. Local update is the source of truth;
// any Gmail-side failure is logged but never rolls back the local
// state — the user clicked archive, they expect it gone.
//
// Lazy-creates a `Hebbs/Snoozed` label on first snooze and caches the
// label id on the connector row's `config.labels.snoozed` so we don't
// hit `users.labels.list` on every call.

import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { connectors, inboxItems } from "@boringos/db";
import type { ActionRunner, ConnectorCredentials } from "@boringos/connector";

const SNOOZED_LABEL_NAME = "Hebbs/Snoozed";
const SOURCE_GMAIL = "google.gmail";
const KIND_GMAIL = "google";

/**
 * Pull the underlying Gmail message id off an inbox item. Stored in
 * the dedicated `source_id` column by `create-inbox-item` (line 91 in
 * the handler) — immune to later metadata edits by triage / replier
 * agents that overwrite `metadata`.
 */
function gmailMessageId(item: { sourceId: string | null; source: string }): string | null {
  if (item.source !== SOURCE_GMAIL) return null;
  return item.sourceId && item.sourceId.length > 0 ? item.sourceId : null;
}

interface ConnectorRow {
  id: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

async function loadConnector(
  db: Db,
  tenantId: string,
): Promise<ConnectorRow | null> {
  const rows = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.kind, KIND_GMAIL)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    credentials: (row.credentials as Record<string, unknown>) ?? null,
    config: (row.config as Record<string, unknown>) ?? null,
  };
}

function credentialsFor(row: ConnectorRow): ConnectorCredentials {
  const c = row.credentials ?? {};
  return {
    accessToken: (c as { accessToken?: string }).accessToken ?? "",
    refreshToken: (c as { refreshToken?: string }).refreshToken,
    config: row.config ?? undefined,
  };
}

/**
 * Resolve the cached label id, creating the label on Gmail's side
 * (and caching it back to the connector row) if this is the first
 * use for the tenant.
 */
async function resolveSnoozedLabelId(
  db: Db,
  actionRunner: ActionRunner,
  tenantId: string,
  row: ConnectorRow,
): Promise<string | null> {
  const cached =
    (row.config?.labels as { snoozed?: string } | undefined)?.snoozed;
  if (cached) return cached;

  const result = await actionRunner.execute(
    {
      connectorKind: KIND_GMAIL,
      action: "ensure_label",
      tenantId,
      inputs: { name: SNOOZED_LABEL_NAME },
    },
    credentialsFor(row),
  );
  if (!result.success) return null;
  const labelId = (result.data as { id?: string } | undefined)?.id ?? null;
  if (!labelId) return null;

  // Persist back so future calls skip the label lookup.
  const nextConfig = {
    ...(row.config ?? {}),
    labels: { ...((row.config?.labels as Record<string, unknown> | undefined) ?? {}), snoozed: labelId },
  };
  await db
    .update(connectors)
    .set({ config: nextConfig, updatedAt: new Date() })
    .where(eq(connectors.id, row.id))
    .catch(() => {});
  return labelId;
}

async function modify(
  actionRunner: ActionRunner,
  tenantId: string,
  row: ConnectorRow,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  const result = await actionRunner.execute(
    {
      connectorKind: KIND_GMAIL,
      action: "modify_email",
      tenantId,
      inputs: { messageId, addLabelIds, removeLabelIds },
    },
    credentialsFor(row),
  );
  if (!result.success) {
    console.warn(
      `[inbox-gmail-sync] modify_email failed for tenant=${tenantId} message=${messageId}:`,
      result.error,
    );
  }
}

async function loadItem(
  db: Db,
  tenantId: string,
  itemId: string,
): Promise<{ source: string; sourceId: string | null } | null> {
  const rows = await db
    .select({ source: inboxItems.source, sourceId: inboxItems.sourceId })
    .from(inboxItems)
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface GmailSyncDeps {
  db: Db;
  actionRunner: ActionRunner;
}

/** Hebbs archive → remove `INBOX` label on the Gmail message. */
export async function syncArchive(
  deps: GmailSyncDeps,
  tenantId: string,
  itemId: string,
): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;
    await modify(deps.actionRunner, tenantId, row, msgId, [], ["INBOX"]);
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncArchive error:`, err);
  }
}

/** Hebbs status: read | unread | snoozed | archived → mirror to labels. */
export async function syncStatusChange(
  deps: GmailSyncDeps,
  tenantId: string,
  itemId: string,
  status: string,
): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;

    if (status === "read") {
      await modify(deps.actionRunner, tenantId, row, msgId, [], ["UNREAD"]);
    } else if (status === "unread") {
      await modify(deps.actionRunner, tenantId, row, msgId, ["UNREAD"], []);
    } else if (status === "snoozed") {
      const labelId = await resolveSnoozedLabelId(deps.db, deps.actionRunner, tenantId, row);
      const add = labelId ? [labelId] : [];
      await modify(deps.actionRunner, tenantId, row, msgId, add, ["INBOX"]);
    } else if (status === "archived") {
      await modify(deps.actionRunner, tenantId, row, msgId, [], ["INBOX"]);
    }
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncStatusChange error:`, err);
  }
}

/** Snooze ticker wake → re-add `INBOX` and remove `Hebbs/Snoozed`. */
export async function syncSnoozeWake(
  deps: GmailSyncDeps,
  tenantId: string,
  itemId: string,
): Promise<void> {
  try {
    const item = await loadItem(deps.db, tenantId, itemId);
    if (!item) return;
    const msgId = gmailMessageId(item);
    if (!msgId) return;
    const row = await loadConnector(deps.db, tenantId);
    if (!row) return;
    const labelId = await resolveSnoozedLabelId(deps.db, deps.actionRunner, tenantId, row);
    const remove = labelId ? [labelId] : [];
    await modify(deps.actionRunner, tenantId, row, msgId, ["INBOX"], remove);
  } catch (err) {
    console.warn(`[inbox-gmail-sync] syncSnoozeWake error:`, err);
  }
}

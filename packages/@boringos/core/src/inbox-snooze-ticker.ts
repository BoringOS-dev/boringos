// SPDX-License-Identifier: BUSL-1.1
//
// Inbox snooze ticker — every 30s, flip any snoozed inbox_items whose
// snooze_until has elapsed back to status='unread' (and clear the
// timestamp so they don't reset). Decoupled from the routine
// scheduler so the snooze tick rate can be tuned independently.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";

export interface InboxSnoozeTicker {
  start(): void;
  stop(): void;
  /** Run a single tick; exposed for tests. Returns the number of items flipped. */
  tickOnce(): Promise<number>;
}

const DEFAULT_INTERVAL_MS = 30_000;

export function createInboxSnoozeTicker(
  db: Db,
  options: { intervalMs?: number } = {},
): InboxSnoozeTicker {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<number> {
    const result = await db.execute<{ count: number }>(sql`
      WITH wakes AS (
        UPDATE inbox_items
           SET status = 'unread',
               snooze_until = NULL,
               updated_at = now()
         WHERE status = 'snoozed'
           AND snooze_until IS NOT NULL
           AND snooze_until <= now()
        RETURNING id
      )
      SELECT count(*)::int AS count FROM wakes;
    `);
    const row = (result as unknown as Array<{ count: number }>)[0];
    return row?.count ?? 0;
  }

  return {
    tickOnce,
    start() {
      if (interval) return;
      // First tick immediately so server restart wakes any items that
      // crossed the threshold while the process was down.
      tickOnce().catch(() => {});
      interval = setInterval(() => {
        tickOnce().catch(() => {});
      }, intervalMs);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

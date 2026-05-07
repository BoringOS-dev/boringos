// SPDX-License-Identifier: BUSL-1.1
//
// Derives the set of task ids that should bubble into "My todos"
// because something went wrong on the agent side. Two signals today:
//
//   1. The task itself is in `blocked` status — explicit signal from
//      an agent that escalated, or the framework after a hard error.
//   2. The most recent agent_run linked to the task ended `failed`.
//      This catches the silent case where the agent crashed mid-run
//      and didn't get a chance to update the task status.
//
// Both signals are unioned. Tasks that the user has already actively
// closed (status === "done" / "cancelled") are excluded so resolved
// items don't keep nagging.

import { useQuery } from "@tanstack/react-query";
import { useClient } from "@boringos/ui";
import type { Task } from "@boringos/ui";

interface RunWithTask {
  id: string;
  taskId?: string | null;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export function useNeedsAttention(tasks: Task[]): Set<string> {
  const client = useClient();

  // Pull failed runs (top 100; admin /runs is capped at 100). Refetch
  // when the tasks list changes so the badge stays current after a
  // wake-and-retry resolves the failure.
  const { data: failedRuns } = useQuery({
    queryKey: ["runs", "failed"],
    queryFn: async () => {
      const rows = await client.getRuns({ status: "failed" });
      return rows as unknown as RunWithTask[];
    },
    // Light polling — failed runs are rare; staleness of a minute or
    // two is fine.
    refetchInterval: 30_000,
  });

  const set = new Set<string>();

  // Signal 1: status === "blocked"
  for (const t of tasks) {
    if (t.status === "blocked") set.add(t.id);
  }

  // Signal 2: failed run linked to a still-open task.
  const openTaskIds = new Set(
    tasks
      .filter((t) => t.status !== "done" && t.status !== "cancelled")
      .map((t) => t.id),
  );
  for (const r of failedRuns ?? []) {
    if (r.taskId && openTaskIds.has(r.taskId)) set.add(r.taskId);
  }

  return set;
}

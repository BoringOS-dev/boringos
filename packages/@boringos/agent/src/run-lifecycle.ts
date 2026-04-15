import { eq } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { agentRuns } from "@boringos/db";
import type { RunLifecycle, CreateRunInput, RunStatusExtra } from "./types.js";
import type { RunStatus } from "@boringos/shared";
import { generateId } from "@boringos/shared";

export function createRunLifecycle(db: Db): RunLifecycle {
  return {
    async create(input: CreateRunInput): Promise<string> {
      const id = generateId();
      await db.insert(agentRuns).values({
        id,
        tenantId: input.tenantId,
        agentId: input.agentId,
        wakeupRequestId: input.wakeupRequestId,
        status: "queued",
        startedAt: new Date(),
      });
      return id;
    },

    async updateStatus(runId: string, status: RunStatus, extra?: RunStatusExtra): Promise<void> {
      const values: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (status === "done" || status === "failed" || status === "cancelled" || status === "skipped") {
        values.finishedAt = new Date();
      }
      if (extra?.exitCode !== undefined) values.exitCode = extra.exitCode;
      if (extra?.error) values.error = extra.error;
      if (extra?.errorCode) values.errorCode = extra.errorCode;
      if (extra?.sessionId) values.sessionIdAfter = extra.sessionId;
      if (extra?.usage) values.usageJson = extra.usage;

      await db.update(agentRuns).set(values).where(eq(agentRuns.id, runId));
    },

    async appendLog(runId: string, line: string): Promise<void> {
      // Append to stdout excerpt (truncate to last 10KB)
      const rows = await db.select({ excerpt: agentRuns.stdoutExcerpt }).from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
      const current = rows[0]?.excerpt ?? "";
      const updated = (current + "\n" + line).slice(-10_000);
      await db.update(agentRuns).set({ stdoutExcerpt: updated, updatedAt: new Date() }).where(eq(agentRuns.id, runId));
    },

    async appendStderr(runId: string, line: string): Promise<void> {
      const rows = await db.select({ excerpt: agentRuns.stderrExcerpt }).from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
      const current = rows[0]?.excerpt ?? "";
      const updated = (current + "\n" + line).slice(-10_000);
      await db.update(agentRuns).set({ stderrExcerpt: updated, updatedAt: new Date() }).where(eq(agentRuns.id, runId));
    },
  };
}

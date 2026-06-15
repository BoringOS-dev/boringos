// task_24 F — auto-checkpoint hook tests.
//
// Confirms the subscriber appends entries to the right log file for
// each wake shape (task-bound, copilot session, no destination) and
// that the entry contains the timestamp + run id + outcome the
// agent will grep for on the next wake.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStorage } from "@boringos/drive";
import { createMemoryCheckpoint } from "@boringos/agent";
import type {
  AfterRunEvent,
  RunErrorEvent,
} from "@boringos/agent";

const T = "tenant-X";
const A = "agent-A";

describe("createMemoryCheckpoint", () => {
  let drive: ReturnType<typeof createLocalStorage>;
  let checkpoint: ReturnType<typeof createMemoryCheckpoint>;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "mem-checkpoint-"));
    drive = createLocalStorage({ root: tmp });
    checkpoint = createMemoryCheckpoint({ drive });
  });

  it("appends a success entry to tasks/<id>/log.md when no session", async () => {
    const event: AfterRunEvent = {
      agentId: A,
      tenantId: T,
      runId: "run-1",
      taskId: "task-1",
      result: { exitCode: 0, sessionId: undefined },
    };
    await checkpoint.onRunFinished(event);

    const body = await drive.readText(`${T}/tasks/task-1/log.md`);
    expect(body).toContain("# Task log");
    expect(body).toContain("run run-1");
    expect(body).toContain("success");
    expect(body).toContain(`agent: ${A}`);
  });

  it("routes session runs to the owner's 60-daily note (memory tree v2)", async () => {
    const event: AfterRunEvent = {
      agentId: A,
      tenantId: T,
      runId: "run-2",
      taskId: "task-2",
      ownerUserId: "user-U",
      sessionId: "sess-9",
      result: { exitCode: 0 },
    };
    await checkpoint.onRunFinished(event);

    // The append-only daily note got the run as a fragment.
    const date = new Date().toISOString().slice(0, 10);
    const daily = await drive.readText(
      `${T}/users/user-U/memory/60-daily/${date}.md`,
    );
    expect(daily).toContain(`# ${date}`); // daily header
    expect(daily).toContain("<!-- frag run run-2"); // machine marker
    expect(daily).toContain("run run-2"); // readable header (id8)
    expect(daily).toContain(`agent: ${A}`);

    // Per-session checkpoint files die — no sessions/<sid>.md.
    expect(await drive.exists(`${T}/users/user-U/sessions/sess-9.md`)).toBe(false);
    // Task log did NOT get the entry — the daily note wins.
    expect(await drive.exists(`${T}/tasks/task-2/log.md`)).toBe(false);
  });

  it("appends multiple entries on the same task in order", async () => {
    const base = {
      agentId: A,
      tenantId: T,
      taskId: "task-3",
    } as const;
    await checkpoint.onRunFinished({
      ...base,
      runId: "run-a",
      result: { exitCode: 0 },
    });
    await checkpoint.onRunFinished({
      ...base,
      runId: "run-b",
      result: { exitCode: 0 },
    });

    const body = await drive.readText(`${T}/tasks/task-3/log.md`);
    expect(body.indexOf("run-a")).toBeLessThan(body.indexOf("run-b"));
    expect(body.split("## ").length - 1).toBe(2);
  });

  it("logs failures via onRunFailed with the error message", async () => {
    const event: RunErrorEvent = {
      agentId: A,
      tenantId: T,
      runId: "run-x",
      taskId: "task-4",
      error: new Error("upstream timed out"),
    };
    await checkpoint.onRunFailed(event);

    const body = await drive.readText(`${T}/tasks/task-4/log.md`);
    expect(body).toContain("error");
    expect(body).toContain("upstream timed out");
  });

  it("is a no-op when there's no destination (no taskId, no session)", async () => {
    const event: AfterRunEvent = {
      agentId: A,
      tenantId: T,
      runId: "run-orphan",
      result: { exitCode: 0 },
    };
    // Should not throw, should not create any file.
    await checkpoint.onRunFinished(event);
    // No file to read; just assert no throw.
  });

  it("includes exit code message on non-zero success path", async () => {
    const event: AfterRunEvent = {
      agentId: A,
      tenantId: T,
      runId: "run-y",
      taskId: "task-5",
      result: { exitCode: 1, errorMessage: undefined },
    };
    await checkpoint.onRunFinished(event);

    const body = await drive.readText(`${T}/tasks/task-5/log.md`);
    expect(body).toContain("failed");
    expect(body).toContain("Exit code 1");
  });
});

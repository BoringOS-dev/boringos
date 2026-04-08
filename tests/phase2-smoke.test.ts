/**
 * Phase 2 Smoke Tests — Context Providers + End-to-End Agent Execution
 *
 * Tests accumulate across phases. Phase 1 tests are in phase1-smoke.test.ts.
 */
import { describe, it, expect } from "vitest";

// ── Persona loader ──────────────────────────────────────────────────────────

describe("persona-loader", () => {
  it("resolves known roles", async () => {
    const { resolvePersonaRole } = await import("@boringos/agent");
    expect(resolvePersonaRole("engineer")).toBe("engineer");
    expect(resolvePersonaRole("ceo")).toBe("ceo");
    expect(resolvePersonaRole("pm")).toBe("pm");
  });

  it("resolves aliases", async () => {
    const { resolvePersonaRole } = await import("@boringos/agent");
    expect(resolvePersonaRole("general")).toBe("engineer");
    expect(resolvePersonaRole("sre")).toBe("devops");
    expect(resolvePersonaRole("product manager")).toBe("pm");
    expect(resolvePersonaRole("assistant")).toBe("personal-assistant");
    expect(resolvePersonaRole("marketing")).toBe("content-creator");
  });

  it("falls back to default for unknown roles", async () => {
    const { resolvePersonaRole } = await import("@boringos/agent");
    expect(resolvePersonaRole("unicorn")).toBe("default");
  });

  it("loads engineer persona bundle with all 3 files", async () => {
    const { loadPersonaBundle } = await import("@boringos/agent");
    const bundle = await loadPersonaBundle("engineer");
    expect(bundle.soul).toBeTruthy();
    expect(bundle.agents).toBeTruthy();
    expect(bundle.heartbeat).toBeTruthy();
  });

  it("loads default persona with only AGENTS.md", async () => {
    const { loadPersonaBundle } = await import("@boringos/agent");
    const bundle = await loadPersonaBundle("default");
    expect(bundle.agents).toBeTruthy();
    expect(bundle.soul).toBeNull();
    expect(bundle.heartbeat).toBeNull();
  });

  it("mergePersonaBundle joins with separator", async () => {
    const { mergePersonaBundle } = await import("@boringos/agent");
    const result = mergePersonaBundle({
      soul: "Soul content",
      agents: "Agents content",
      heartbeat: "Heartbeat content",
    });
    expect(result).toContain("Soul content");
    expect(result).toContain("Agents content");
    expect(result).toContain("Heartbeat content");
    expect(result).toContain("---");
  });
});

// ── Individual providers ────────────────────────────────────────────────────

describe("context providers", () => {
  const mockAgent = {
    id: "agent-1",
    tenantId: "tenant-1",
    name: "Test Agent",
    role: "engineer",
    title: "Senior Engineer",
    icon: null,
    status: "idle" as const,
    reportsTo: null,
    instructions: "Always write tests",
    runtimeId: null,
    fallbackRuntimeId: null,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: {},
    metadata: null,
    lastHeartbeatAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseEvent = {
    agent: mockAgent,
    tenantId: "tenant-1",
    runId: "run-1",
    wakeReason: "manual_request" as const,
    memory: null,
    callbackUrl: "http://localhost:3000",
    callbackToken: "test-token",
  };

  it("headerProvider — includes agent name and role", async () => {
    const { headerProvider } = await import("@boringos/agent");
    const result = await headerProvider.provide(baseEvent);
    expect(result).toContain("Test Agent");
    expect(result).toContain("engineer");
    expect(result).toContain("Senior Engineer");
  });

  it("personaProvider — loads engineer persona", async () => {
    const { personaProvider } = await import("@boringos/agent");
    const result = await personaProvider.provide(baseEvent);
    expect(result).toBeTruthy();
    expect(result!.length).toBeGreaterThan(100); // substantial content
  });

  it("memorySkillProvider — returns null when no memory", async () => {
    const { memorySkillProvider } = await import("@boringos/agent");
    const result = await memorySkillProvider.provide(baseEvent);
    expect(result).toBeNull();
  });

  it("memorySkillProvider — returns skill markdown when memory configured", async () => {
    const { memorySkillProvider } = await import("@boringos/agent");
    const { createHebbsMemory } = await import("@boringos/memory");
    const memory = createHebbsMemory({ endpoint: "http://localhost:1", apiKey: "test" });
    const result = await memorySkillProvider.provide({ ...baseEvent, memory });
    expect(result).toContain("Memory Skill");
  });

  it("agentInstructionsProvider — includes custom instructions", async () => {
    const { agentInstructionsProvider } = await import("@boringos/agent");
    const result = await agentInstructionsProvider.provide(baseEvent);
    expect(result).toContain("Always write tests");
  });

  it("agentInstructionsProvider — returns null when no instructions", async () => {
    const { agentInstructionsProvider } = await import("@boringos/agent");
    const result = await agentInstructionsProvider.provide({
      ...baseEvent,
      agent: { ...mockAgent, instructions: null },
    });
    expect(result).toBeNull();
  });

  it("protocolProvider — includes callback URL and curl examples", async () => {
    const { protocolProvider } = await import("@boringos/agent");
    const result = await protocolProvider.provide({ ...baseEvent, taskId: "task-1" });
    expect(result).toContain("Execution Protocol");
    expect(result).toContain("http://localhost:3000");
    expect(result).toContain("curl");
    expect(result).toContain("/api/agent/tasks/task-1");
  });

  it("sessionProvider — first run orientation when no prior session", async () => {
    const { sessionProvider } = await import("@boringos/agent");
    const result = await sessionProvider.provide({ ...baseEvent, taskId: "task-1" });
    expect(result).toContain("First Run");
  });

  it("sessionProvider — session handoff when resuming", async () => {
    const { sessionProvider } = await import("@boringos/agent");
    const result = await sessionProvider.provide({
      ...baseEvent,
      previousSessionId: "session-abc-123-def",
      previousSessionSummary: "Completed initial research",
    });
    expect(result).toContain("Session Handoff");
    expect(result).toContain("session-abc-");
    expect(result).toContain("Completed initial research");
  });

  it("sessionProvider — summary fallback when session expired", async () => {
    const { sessionProvider } = await import("@boringos/agent");
    const result = await sessionProvider.provide({
      ...baseEvent,
      previousSessionSummary: "Prior work summary",
    });
    expect(result).toContain("Prior Context");
    expect(result).toContain("Prior work summary");
  });
});

// ── Full pipeline with all providers ────────────────────────────────────────

describe("full context pipeline", () => {
  it("builds system instructions with header + persona + protocol", async () => {
    const { ContextPipeline, headerProvider, personaProvider, protocolProvider } = await import("@boringos/agent");
    const pipeline = new ContextPipeline();
    pipeline.add(headerProvider);
    pipeline.add(personaProvider);
    pipeline.add(protocolProvider);

    const result = await pipeline.build({
      agent: {
        id: "a-1", tenantId: "t-1", name: "Eng Bot", role: "engineer",
        title: null, icon: null, status: "idle" as const, reportsTo: null,
        instructions: null, runtimeId: null, fallbackRuntimeId: null,
        budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null,
        pausedAt: null, permissions: {}, metadata: null, lastHeartbeatAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      },
      tenantId: "t-1",
      runId: "r-1",
      taskId: "task-1",
      wakeReason: "manual_request" as const,
      memory: null,
      callbackUrl: "http://localhost:3000",
      callbackToken: "tok",
    });

    // System instructions should have header, persona, and protocol
    expect(result.systemInstructions).toContain("Eng Bot");
    expect(result.systemInstructions).toContain("engineer");
    expect(result.systemInstructions).toContain("Execution Protocol");
    expect(result.systemInstructions).toContain("curl");

    // Persona content should be substantial
    expect(result.systemInstructions.length).toBeGreaterThan(500);
  });
});

// ── End-to-end: BoringOS boots with context pipeline ──────────────────────

describe("end-to-end: BoringOS with context", () => {
  it("boots and /health responds with providers registered", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-e2e-"));

    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5597 },
      drive: { root: join(dataDir, "drive") },
    });

    const server = await app.listen(0);

    try {
      const res = await fetch(`${server.url}/health`);
      expect(res.status).toBe(200);

      // Verify agent engine has providers registered (via context)
      expect(server.context.agentEngine).toBeTruthy();
    } finally {
      await server.close();
    }
  }, 30000);
});

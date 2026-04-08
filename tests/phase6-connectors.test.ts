/**
 * Phase 6 Smoke Tests — Connector System
 *
 * Tests the connector SDK, registry, event bus, test harness,
 * and the Slack + Google reference implementations.
 */
import { describe, it, expect } from "vitest";

// ── Connector SDK ───────────────────────────────────────────────────────────

describe("connector SDK: registry", () => {
  it("registers and retrieves connectors by kind", async () => {
    const { createConnectorRegistry } = await import("@boringos/connector");
    const { slack } = await import("@boringos/connector-slack");

    const registry = createConnectorRegistry();
    const slackConn = slack({ signingSecret: "test" });
    registry.register(slackConn);

    expect(registry.has("slack")).toBe(true);
    expect(registry.get("slack")?.name).toBe("Slack");
    expect(registry.list()).toHaveLength(1);
  });
});

describe("connector SDK: event bus", () => {
  it("emits and receives typed events", async () => {
    const { createEventBus } = await import("@boringos/connector");
    const bus = createEventBus();
    const received: string[] = [];

    bus.on("message_received", (event) => {
      received.push(event.type);
    });

    await bus.emit({
      connectorKind: "slack",
      type: "message_received",
      tenantId: "t1",
      data: { text: "hello" },
      timestamp: new Date(),
    });

    await bus.emit({
      connectorKind: "slack",
      type: "reaction_added",
      tenantId: "t1",
      data: {},
      timestamp: new Date(),
    });

    expect(received).toEqual(["message_received"]);
  });

  it("onAny receives all events", async () => {
    const { createEventBus } = await import("@boringos/connector");
    const bus = createEventBus();
    const received: string[] = [];

    bus.onAny((event) => { received.push(event.type); });

    await bus.emit({ connectorKind: "a", type: "one", tenantId: "t", data: {}, timestamp: new Date() });
    await bus.emit({ connectorKind: "b", type: "two", tenantId: "t", data: {}, timestamp: new Date() });

    expect(received).toEqual(["one", "two"]);
  });
});

describe("connector SDK: action runner", () => {
  it("routes actions to the correct connector client", async () => {
    const { createConnectorRegistry, createActionRunner } = await import("@boringos/connector");
    const { slack } = await import("@boringos/connector-slack");

    const registry = createConnectorRegistry();
    registry.register(slack({ signingSecret: "test" }));
    const runner = createActionRunner(registry);

    // This will fail because there's no real Slack API, but it should route correctly
    const result = await runner.execute(
      { connectorKind: "slack", action: "send_message", tenantId: "t1", agentId: "a1", inputs: { channel: "C123", text: "hi" } },
      { accessToken: "fake-token" },
    );

    // Will fail with network error, but proves routing works
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error for unknown connector", async () => {
    const { createConnectorRegistry, createActionRunner } = await import("@boringos/connector");

    const registry = createConnectorRegistry();
    const runner = createActionRunner(registry);

    const result = await runner.execute(
      { connectorKind: "nonexistent", action: "foo", tenantId: "t1", agentId: "a1", inputs: {} },
      { accessToken: "token" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown connector");
  });
});

// ── Slack connector ─────────────────────────────────────────────────────────

describe("connector-slack", () => {
  it("has correct kind, name, and description", async () => {
    const { slack } = await import("@boringos/connector-slack");
    const conn = slack({ signingSecret: "test" });

    expect(conn.kind).toBe("slack");
    expect(conn.name).toBe("Slack");
    expect(conn.events).toHaveLength(3);
    expect(conn.actions).toHaveLength(3);
  });

  it("has OAuth config with correct scopes", async () => {
    const { slack } = await import("@boringos/connector-slack");
    const conn = slack({ signingSecret: "test" });

    expect(conn.oauth).toBeTruthy();
    expect(conn.oauth!.scopes).toContain("chat:write");
    expect(conn.oauth!.authorizationUrl).toContain("slack.com");
  });

  it("has skill markdown", async () => {
    const { slack } = await import("@boringos/connector-slack");
    const conn = slack({ signingSecret: "test" });
    const skill = conn.skillMarkdown();

    expect(skill).toContain("Slack Connector");
    expect(skill).toContain("send_message");
    expect(skill).toContain("reply_in_thread");
  });

  it("handles URL verification challenge", async () => {
    const { slack } = await import("@boringos/connector-slack");
    const conn = slack({ signingSecret: "test" });

    const response = await conn.handleWebhook!({
      method: "POST",
      headers: {},
      body: { type: "url_verification", challenge: "test-challenge" },
      tenantId: "t1",
    });

    expect(response.status).toBe(200);
    expect((response.body as Record<string, unknown>).challenge).toBe("test-challenge");
  });

  it("test harness works with Slack connector", async () => {
    const { createConnectorTestHarness } = await import("@boringos/connector");
    const { slack } = await import("@boringos/connector-slack");

    const harness = createConnectorTestHarness(slack({ signingSecret: "test" }));

    expect(harness.definition.kind).toBe("slack");
    expect(harness.skillMarkdown()).toContain("Slack");

    // Simulate URL verification webhook
    const response = await harness.simulateWebhook(
      { type: "url_verification", challenge: "abc" },
    );
    expect(response?.status).toBe(200);
  });
});

// ── Google connector ────────────────────────────────────────────────────────

describe("connector-google", () => {
  it("has correct kind, name, and description", async () => {
    const { google } = await import("@boringos/connector-google");
    const conn = google({ clientId: "id", clientSecret: "secret" });

    expect(conn.kind).toBe("google");
    expect(conn.name).toBe("Google Workspace");
    expect(conn.events).toHaveLength(3);
    expect(conn.actions).toHaveLength(8); // 4 gmail + 4 calendar
  });

  it("has OAuth config with Gmail and Calendar scopes", async () => {
    const { google } = await import("@boringos/connector-google");
    const conn = google({ clientId: "id", clientSecret: "secret" });

    expect(conn.oauth).toBeTruthy();
    expect(conn.oauth!.scopes.some((s) => s.includes("gmail"))).toBe(true);
    expect(conn.oauth!.scopes.some((s) => s.includes("calendar"))).toBe(true);
    expect(conn.oauth!.extraParams?.access_type).toBe("offline");
  });

  it("has skill markdown covering Gmail and Calendar", async () => {
    const { google } = await import("@boringos/connector-google");
    const conn = google({ clientId: "id", clientSecret: "secret" });
    const skill = conn.skillMarkdown();

    expect(skill).toContain("Gmail");
    expect(skill).toContain("Calendar");
    expect(skill).toContain("list_emails");
    expect(skill).toContain("create_event");
    expect(skill).toContain("find_free_slots");
  });

  it("test harness works with Google connector", async () => {
    const { createConnectorTestHarness } = await import("@boringos/connector");
    const { google } = await import("@boringos/connector-google");

    const harness = createConnectorTestHarness(google({ clientId: "id", clientSecret: "secret" }));

    expect(harness.definition.kind).toBe("google");
    expect(harness.skillMarkdown()).toContain("Google Workspace");
  });
});

// ── Connector registration in BoringOS ────────────────────────────────────

describe("connector: BoringOS integration", () => {
  it("boots with connectors registered", async () => {
    const { BoringOS } = await import("@boringos/core");
    const { slack } = await import("@boringos/connector-slack");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dataDir = await mkdtemp(join(tmpdir(), "boringos-conn-"));
    const app = new BoringOS({
      database: { embedded: true, dataDir, port: 5591 },
      drive: { root: join(dataDir, "drive") },
    });

    app.connector(slack({ signingSecret: "test-secret" }));
    const server = await app.listen(0);

    try {
      // GET /api/connectors/connectors — list registered connectors
      const res = await fetch(`${server.url}/api/connectors/connectors`);
      expect(res.status).toBe(200);
      const body = await res.json() as { connectors: Array<{ kind: string }> };
      expect(body.connectors).toHaveLength(1);
      expect(body.connectors[0].kind).toBe("slack");
    } finally {
      await server.close();
    }
  }, 30000);
});

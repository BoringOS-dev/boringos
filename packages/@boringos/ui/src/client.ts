import type {
  Agent,
  Task,
  TaskComment,
  AgentRun,
  Approval,
} from "@boringos/shared";

// ── Client config ────────────────────────────────────────────────────────────

export interface BoringOSClientConfig {
  url: string;
  token?: string;
}

// ── Response types ───────────────────────────────────────────────────────────

export interface TaskWithComments {
  task: Task;
  comments: TaskComment[];
}

export interface ConnectorInfo {
  kind: string;
  name: string;
  description: string;
  events: Array<{ type: string; description: string }>;
  actions: Array<{ name: string; description: string }>;
  hasOAuth: boolean;
}

export interface WorkflowInfo {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  status: string;
  blocks: unknown[];
  edges: unknown[];
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

// ── The client ───────────────────────────────────────────────────────────────

export interface BoringOSClient {
  // Health
  health(): Promise<HealthStatus>;

  // Agents
  getAgents(): Promise<Agent[]>;
  createAgent(data: { tenantId: string; name: string; role?: string; instructions?: string }): Promise<{ id: string }>;

  // Tasks
  getTask(taskId: string): Promise<TaskWithComments>;
  getTasks(): Promise<Task[]>;
  createTask(data: { tenantId: string; title: string; description?: string; priority?: string; assigneeAgentId?: string; parentId?: string }): Promise<{ id: string }>;
  updateTask(taskId: string, data: { status?: string; title?: string; description?: string }): Promise<void>;

  // Comments
  postComment(taskId: string, data: { body: string }): Promise<{ id: string }>;

  // Work products
  addWorkProduct(taskId: string, data: { kind: string; title: string; url?: string }): Promise<{ id: string }>;

  // Runs
  getRuns(): Promise<AgentRun[]>;

  // Cost
  reportCost(runId: string, data: { inputTokens: number; outputTokens: number; model?: string; costUsd?: number }): Promise<void>;

  // Connectors
  getConnectors(): Promise<ConnectorInfo[]>;
  invokeAction(kind: string, action: string, inputs: Record<string, unknown>): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
}

export function createBoringOSClient(config: BoringOSClientConfig): BoringOSClient {
  const baseUrl = config.url.replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.token) h["Authorization"] = `Bearer ${config.token}`;
    return h;
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers: headers() });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function patch(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  }

  return {
    health: () => get<HealthStatus>("/health"),

    getAgents: async () => {
      const res = await get<{ agents: Agent[] }>("/api/agent/agents");
      return res.agents;
    },
    createAgent: (data) => post<{ id: string }>("/api/agent/agents", data),

    // Tasks
    getTask: (taskId) => get<TaskWithComments>(`/api/agent/tasks/${taskId}`),
    getTasks: async () => {
      const res = await get<{ tasks: Task[] }>("/api/agent/tasks");
      return res.tasks;
    },
    createTask: (data) => post<{ id: string }>("/api/agent/tasks", data),
    updateTask: (taskId, data) => patch(`/api/agent/tasks/${taskId}`, data),

    // Comments
    postComment: (taskId, data) => post<{ id: string }>(`/api/agent/tasks/${taskId}/comments`, data),

    // Work products
    addWorkProduct: (taskId, data) => post<{ id: string }>(`/api/agent/tasks/${taskId}/work-products`, data),

    // Runs
    getRuns: async () => {
      const res = await get<{ runs: AgentRun[] }>("/api/agent/runs");
      return res.runs;
    },

    // Cost
    reportCost: async (runId, data) => {
      await post(`/api/agent/runs/${runId}/cost`, data);
    },

    // Connectors
    getConnectors: async () => {
      const res = await get<{ connectors: ConnectorInfo[] }>("/api/connectors/connectors");
      return res.connectors;
    },
    invokeAction: (kind, action, inputs) =>
      post<{ success: boolean; data?: Record<string, unknown>; error?: string }>(
        `/api/connectors/actions/${kind}/${action}`,
        inputs,
      ),
  };
}

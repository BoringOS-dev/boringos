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
  apiKey?: string;
  tenantId?: string;
  token?: string;  // legacy callback JWT — prefer apiKey for admin access
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

  // Tenants
  createTenant(data: { name: string; slug: string }): Promise<Record<string, unknown>>;
  getCurrentTenant(): Promise<Record<string, unknown>>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  createAgent(data: { name: string; role?: string; instructions?: string; runtimeId?: string }): Promise<Agent>;
  updateAgent(agentId: string, data: { name?: string; role?: string; instructions?: string; status?: string }): Promise<Agent>;
  wakeAgent(agentId: string, taskId?: string): Promise<Record<string, unknown>>;
  getAgentRuns(agentId: string): Promise<AgentRun[]>;

  // Tasks
  getTasks(filters?: { status?: string; assigneeAgentId?: string }): Promise<Task[]>;
  getTask(taskId: string): Promise<TaskWithComments>;
  createTask(data: { title: string; description?: string; priority?: string; assigneeAgentId?: string; parentId?: string }): Promise<Task>;
  updateTask(taskId: string, data: { status?: string; title?: string; description?: string; priority?: string; assigneeAgentId?: string }): Promise<Task>;
  deleteTask(taskId: string): Promise<void>;
  postComment(taskId: string, data: { body: string }): Promise<{ id: string }>;
  assignTask(taskId: string, agentId: string, wake?: boolean): Promise<Record<string, unknown>>;
  addWorkProduct(taskId: string, data: { kind: string; title: string; url?: string }): Promise<{ id: string }>;

  // Runs
  getRuns(filters?: { agentId?: string; status?: string }): Promise<AgentRun[]>;
  getRun(runId: string): Promise<AgentRun>;
  cancelRun(runId: string): Promise<void>;

  // Runtimes
  getRuntimes(): Promise<Record<string, unknown>[]>;
  createRuntime(data: { name: string; type: string; config?: Record<string, unknown>; model?: string }): Promise<Record<string, unknown>>;
  updateRuntime(runtimeId: string, data: { name?: string; config?: Record<string, unknown>; model?: string }): Promise<Record<string, unknown>>;
  deleteRuntime(runtimeId: string): Promise<void>;
  setDefaultRuntime(runtimeId: string): Promise<void>;

  // Approvals
  getApprovals(status?: string): Promise<Approval[]>;
  getApproval(approvalId: string): Promise<Approval>;
  approveApproval(approvalId: string, note?: string): Promise<void>;
  rejectApproval(approvalId: string, reason?: string): Promise<void>;

  // Cost
  getCosts(): Promise<Record<string, unknown>[]>;
  reportCost(runId: string, data: { inputTokens: number; outputTokens: number; model?: string; costUsd?: number }): Promise<void>;

  // Connectors
  getConnectors(): Promise<ConnectorInfo[]>;
  invokeAction(kind: string, action: string, inputs: Record<string, unknown>): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;

  // Realtime
  subscribe(onEvent: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
}

export function createBoringOSClient(config: BoringOSClientConfig): BoringOSClient {
  const baseUrl = config.url.replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) h["X-API-Key"] = config.apiKey;
    if (config.tenantId) h["X-Tenant-Id"] = config.tenantId;
    if (config.token) h["Authorization"] = `Bearer ${config.token}`;
    return h;
  }

  // Use admin API when apiKey is set, callback API otherwise
  const api = config.apiKey ? "/api/admin" : "/api/agent";

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

  async function patch<T = void>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function del(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  }

  return {
    health: () => get<HealthStatus>("/health"),

    // Tenants
    createTenant: (data) => post<Record<string, unknown>>(`${api}/tenants`, data),
    getCurrentTenant: () => get<Record<string, unknown>>(`${api}/tenants/current`),

    // Agents
    getAgents: async () => {
      const res = await get<{ agents: Agent[] }>(`${api}/agents`);
      return res.agents;
    },
    getAgent: (agentId) => get<Agent>(`${api}/agents/${agentId}`),
    createAgent: (data) => post<Agent>(`${api}/agents`, data),
    updateAgent: (agentId, data) => patch<Agent>(`${api}/agents/${agentId}`, data),
    wakeAgent: (agentId, taskId?) => post<Record<string, unknown>>(`${api}/agents/${agentId}/wake`, { taskId }),
    getAgentRuns: async (agentId) => {
      const res = await get<{ runs: AgentRun[] }>(`${api}/agents/${agentId}/runs`);
      return res.runs;
    },

    // Tasks
    getTasks: async (filters?) => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.assigneeAgentId) params.set("assigneeAgentId", filters.assigneeAgentId);
      const qs = params.toString();
      const res = await get<{ tasks: Task[] }>(`${api}/tasks${qs ? `?${qs}` : ""}`);
      return res.tasks;
    },
    getTask: (taskId) => get<TaskWithComments>(`${api}/tasks/${taskId}`),
    createTask: (data) => post<Task>(`${api}/tasks`, data),
    updateTask: (taskId, data) => patch<Task>(`${api}/tasks/${taskId}`, data),
    deleteTask: (taskId) => del(`${api}/tasks/${taskId}`),
    postComment: (taskId, data) => post<{ id: string }>(`${api}/tasks/${taskId}/comments`, data),
    assignTask: (taskId, agentId, wake?) => post<Record<string, unknown>>(`${api}/tasks/${taskId}/assign`, { agentId, wake }),
    addWorkProduct: (taskId, data) => post<{ id: string }>(`${api}/tasks/${taskId}/work-products`, data),

    // Runs
    getRuns: async (filters?) => {
      const params = new URLSearchParams();
      if (filters?.agentId) params.set("agentId", filters.agentId);
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      const res = await get<{ runs: AgentRun[] }>(`${api}/runs${qs ? `?${qs}` : ""}`);
      return res.runs;
    },
    getRun: (runId) => get<AgentRun>(`${api}/runs/${runId}`),
    cancelRun: async (runId) => { await post(`${api}/runs/${runId}/cancel`, {}); },

    // Runtimes
    getRuntimes: async () => {
      const res = await get<{ runtimes: Record<string, unknown>[] }>(`${api}/runtimes`);
      return res.runtimes;
    },
    createRuntime: (data) => post<Record<string, unknown>>(`${api}/runtimes`, data),
    updateRuntime: (runtimeId, data) => patch<Record<string, unknown>>(`${api}/runtimes/${runtimeId}`, data),
    deleteRuntime: (runtimeId) => del(`${api}/runtimes/${runtimeId}`),
    setDefaultRuntime: async (runtimeId) => { await post(`${api}/runtimes/${runtimeId}/default`, {}); },

    // Approvals
    getApprovals: async (status?) => {
      const qs = status ? `?status=${status}` : "";
      const res = await get<{ approvals: Approval[] }>(`${api}/approvals${qs}`);
      return res.approvals;
    },
    getApproval: (approvalId) => get<Approval>(`${api}/approvals/${approvalId}`),
    approveApproval: async (approvalId, note?) => { await post(`${api}/approvals/${approvalId}/approve`, { note }); },
    rejectApproval: async (approvalId, reason?) => { await post(`${api}/approvals/${approvalId}/reject`, { reason }); },

    // Costs
    getCosts: async () => {
      const res = await get<{ costs: Record<string, unknown>[] }>(`${api}/costs`);
      return res.costs;
    },
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

    // Realtime SSE subscription
    subscribe: (onEvent) => {
      const params = new URLSearchParams();
      if (config.apiKey) params.set("apiKey", config.apiKey);
      if (config.tenantId) params.set("tenantId", config.tenantId);

      const eventSource = new EventSource(`${baseUrl}/api/events?${params}`);

      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          onEvent(event);
        } catch {}
      };

      return () => eventSource.close();
    },
  };
}

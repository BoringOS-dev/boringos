import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "./provider.js";

// ── Agents ───────────────────────────────────────────────────────────────────

export function useAgents() {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["agents"],
    queryFn: () => client.getAgents(),
  });

  const createAgent = useMutation({
    mutationFn: (data: { name: string; role?: string; instructions?: string; runtimeId?: string }) =>
      client.createAgent(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const updateAgent = useMutation({
    mutationFn: (params: { agentId: string; data: { name?: string; role?: string; instructions?: string; status?: string; runtimeId?: string; fallbackRuntimeId?: string } }) =>
      client.updateAgent(params.agentId, params.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const wakeAgent = useMutation({
    mutationFn: (params: { agentId: string; taskId?: string }) =>
      client.wakeAgent(params.agentId, params.taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });

  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createAgent: createAgent.mutateAsync,
    updateAgent: updateAgent.mutateAsync,
    wakeAgent: wakeAgent.mutateAsync,
    isCreating: createAgent.isPending,
    isUpdating: updateAgent.isPending,
  };
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function useTasks(filters?: { status?: string; assigneeAgentId?: string }) {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => client.getTasks(filters),
  });

  const createTask = useMutation({
    mutationFn: (data: { title: string; description?: string; priority?: string; assigneeAgentId?: string; parentId?: string }) =>
      client.createTask(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createTask: createTask.mutateAsync,
    isCreating: createTask.isPending,
  };
}

export function useTask(taskId: string) {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => client.getTask(taskId),
    enabled: !!taskId,
  });

  const updateTask = useMutation({
    mutationFn: (data: { status?: string; title?: string; description?: string; priority?: string; assigneeAgentId?: string }) =>
      client.updateTask(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const postComment = useMutation({
    mutationFn: (body: string) => client.postComment(taskId, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const assignTask = useMutation({
    mutationFn: (params: { agentId: string; wake?: boolean }) =>
      client.assignTask(taskId, params.agentId, params.wake),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const addWorkProduct = useMutation({
    mutationFn: (data: { kind: string; title: string; url?: string }) =>
      client.addWorkProduct(taskId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  return {
    task: query.data?.task ?? null,
    comments: query.data?.comments ?? [],
    isLoading: query.isLoading,
    error: query.error,
    updateTask: updateTask.mutateAsync,
    postComment: postComment.mutateAsync,
    assignTask: assignTask.mutateAsync,
    addWorkProduct: addWorkProduct.mutateAsync,
  };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function useRuns(filters?: { agentId?: string; status?: string }) {
  const client = useClient();

  const query = useQuery({
    queryKey: ["runs", filters],
    queryFn: () => client.getRuns(filters),
    refetchInterval: 5000,
  });

  const cancelRun = useMutation({
    mutationFn: (runId: string) => client.cancelRun(runId),
  });

  return {
    runs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    cancelRun: cancelRun.mutateAsync,
  };
}

// ── Runtimes ─────────────────────────────────────────────────────────────────

export function useRuntimes() {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["runtimes"],
    queryFn: () => client.getRuntimes(),
  });

  const createRuntime = useMutation({
    mutationFn: (data: { name: string; type: string; config?: Record<string, unknown>; model?: string }) =>
      client.createRuntime(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runtimes"] }),
  });

  const updateRuntime = useMutation({
    mutationFn: (params: { runtimeId: string; data: { name?: string; config?: Record<string, unknown>; model?: string } }) =>
      client.updateRuntime(params.runtimeId, params.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runtimes"] }),
  });

  const deleteRuntime = useMutation({
    mutationFn: (runtimeId: string) => client.deleteRuntime(runtimeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runtimes"] }),
  });

  const setDefault = useMutation({
    mutationFn: (runtimeId: string) => client.setDefaultRuntime(runtimeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runtimes"] }),
  });

  return {
    runtimes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createRuntime: createRuntime.mutateAsync,
    updateRuntime: updateRuntime.mutateAsync,
    deleteRuntime: deleteRuntime.mutateAsync,
    setDefault: setDefault.mutateAsync,
  };
}

// ── Runtime Models ────────────────────────────────────────────────────────────

export function useRuntimeModels(runtimeId: string | undefined) {
  const client = useClient();

  return useQuery({
    queryKey: ["runtimeModels", runtimeId],
    queryFn: () => client.getRuntimeModels(runtimeId!),
    enabled: !!runtimeId,
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function useSettings() {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => client.getSettings(),
  });

  const updateSettings = useMutation({
    mutationFn: (data: Record<string, unknown>) => client.updateSettings(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  return {
    settings: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
    updateSettings: updateSettings.mutateAsync,
    isUpdating: updateSettings.isPending,
  };
}

// ── Approvals ────────────────────────────────────────────────────────────────

export function useApprovals(status?: string) {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => client.getApprovals(status),
  });

  const approve = useMutation({
    mutationFn: (params: { approvalId: string; note?: string }) =>
      client.approveApproval(params.approvalId, params.note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });

  const reject = useMutation({
    mutationFn: (params: { approvalId: string; reason?: string }) =>
      client.rejectApproval(params.approvalId, params.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });

  return {
    approvals: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    approve: approve.mutateAsync,
    reject: reject.mutateAsync,
  };
}

// ── Connectors ───────────────────────────────────────────────────────────────

export function useConnectors() {
  const client = useClient();

  const query = useQuery({
    queryKey: ["connectors"],
    queryFn: () => client.getConnectors(),
  });

  const invokeAction = useMutation({
    mutationFn: (params: { kind: string; action: string; inputs: Record<string, unknown> }) =>
      client.invokeAction(params.kind, params.action, params.inputs),
  });

  return {
    connectors: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    invokeAction: invokeAction.mutateAsync,
    isInvoking: invokeAction.isPending,
  };
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function useProjects() {
  const client = useClient();
  // Projects endpoint — uses admin API pattern
  return useQuery({ queryKey: ["projects"], queryFn: async () => [] as Record<string, unknown>[] });
}

// ── Goals ────────────────────────────────────────────────────────────────────

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: async () => [] as Record<string, unknown>[] });
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export function useOnboarding() {
  return useQuery({ queryKey: ["onboarding"], queryFn: async () => ({ currentStep: 1, totalSteps: 5, completedSteps: [] as number[], completed: false }) });
}

// ── Evals ────────────────────────────────────────────────────────────────────

export function useEvals() {
  return useQuery({ queryKey: ["evals"], queryFn: async () => [] as Record<string, unknown>[] });
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export function useInbox(status?: string) {
  const client = useClient();
  return useQuery({
    queryKey: ["inbox", status],
    queryFn: () => client.getInbox(status ? { status } : undefined),
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

// ── Entity References ─────────────────────────────────────────────────────

export function useEntityRefs(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["entityRefs", entityType, entityId],
    queryFn: async () => ({ refs: {} as Record<string, string[]> }),
    enabled: !!entityType && !!entityId,
  });
}

// ── Search ───────────────────────────────────────────────────────────────

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: async () => ({ tasks: [], agents: [], inboxItems: [] }),
    enabled: query.length >= 2,
  });
}

// ── Health ────────────────────────────────────────────────────────────────

export function useHealth() {
  const client = useClient();

  const query = useQuery({
    queryKey: ["health"],
    queryFn: () => client.health(),
    refetchInterval: 30000,
  });

  return {
    status: query.data?.status ?? null,
    timestamp: query.data?.timestamp ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

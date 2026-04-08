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
    mutationFn: (data: { tenantId: string; name: string; role?: string; instructions?: string }) =>
      client.createAgent(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createAgent: createAgent.mutateAsync,
    isCreating: createAgent.isPending,
  };
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function useTasks() {
  const client = useClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tasks"],
    queryFn: () => client.getTasks(),
  });

  const createTask = useMutation({
    mutationFn: (data: { tenantId: string; title: string; description?: string; priority?: string; assigneeAgentId?: string; parentId?: string }) =>
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

  const updateStatus = useMutation({
    mutationFn: (status: string) => client.updateTask(taskId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const postComment = useMutation({
    mutationFn: (body: string) => client.postComment(taskId, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
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
    updateStatus: updateStatus.mutateAsync,
    postComment: postComment.mutateAsync,
    addWorkProduct: addWorkProduct.mutateAsync,
  };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function useRuns() {
  const client = useClient();

  const query = useQuery({
    queryKey: ["runs"],
    queryFn: () => client.getRuns(),
    refetchInterval: 5000, // poll for run status updates
  });

  return {
    runs: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
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

// ── Health ────────────────────────────────────────────────────────────────────

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

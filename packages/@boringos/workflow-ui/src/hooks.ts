import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workflow, WorkflowBlock, WorkflowEdge, WorkflowRun, WorkflowStatus, BlockRun } from "./types.js";

// ── API helpers ────────────────────────────────────────────────────────────

/**
 * Reads token + tenantId from localStorage. Apps using a different auth
 * scheme can wrap admin() and override these. Kept simple to match the
 * patterns shipping in @boringos/ui.
 */
function authHeaders(): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  const tenantId = typeof localStorage !== "undefined" ? localStorage.getItem("tenantId") : null;
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  return h;
}

async function admin<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, { headers: authHeaders(), ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Queries ────────────────────────────────────────────────────────────────

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: () => admin<{ workflows: Workflow[] }>("/workflows"),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ["workflows", id],
    queryFn: () => admin<Workflow>(`/workflows/${id}`),
    enabled: !!id,
  });
}

export function useWorkflowRuns(workflowId: string | undefined) {
  return useQuery({
    queryKey: ["workflows", workflowId, "runs"],
    queryFn: () => admin<{ runs: WorkflowRun[] }>(`/workflows/${workflowId}/runs?limit=100`),
    enabled: !!workflowId,
    refetchInterval: 15000,
  });
}

/**
 * Fetches one run + its block runs and subscribes to the SSE event stream
 * scoped to that run, invalidating the cache on each event so the UI stays
 * in sync with the engine without reconstructing partial state.
 *
 * Backup poll runs at 10s while a run is queued / running, in case the SSE
 * connection drops.
 */
export function useWorkflowRun(runId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["workflow-runs", runId],
    queryFn: () => admin<{ run: WorkflowRun; blocks: BlockRun[] }>(`/workflow-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => {
      const run = q.state.data?.run;
      if (run && (run.status === "running" || run.status === "queued")) return 10000;
      return false;
    },
  });

  useEffect(() => {
    if (!runId) return;
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    const url = `/api/admin/workflow-runs/${runId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    const onEvent = () => qc.invalidateQueries({ queryKey: ["workflow-runs", runId] });
    const types = [
      "workflow:run_started",
      "workflow:run_completed",
      "workflow:run_failed",
      "workflow:run_paused",
      "workflow:block_started",
      "workflow:block_completed",
      "workflow:block_failed",
      "workflow:block_waiting",
      "workflow:block_skipped",
    ];
    for (const t of types) es.addEventListener(t, onEvent);
    return () => {
      for (const t of types) es.removeEventListener(t, onEvent);
      es.close();
    };
  }, [runId, qc]);

  return query;
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useUpdateWorkflowStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkflowStatus }) =>
      admin<Workflow>(`/workflows/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflows", vars.id] });
    },
  });
}

export function useExecuteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: Record<string, unknown> }) =>
      admin<{ runId: string; status: string; error?: string }>(`/workflows/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ payload: payload ?? {} }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows", vars.id, "runs"] });
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Workflow, "name" | "blocks" | "edges" | "status" | "governingAgentId">> }) =>
      admin<Workflow>(`/workflows/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflows", vars.id] });
    },
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; blocks?: WorkflowBlock[]; edges?: WorkflowEdge[] }) =>
      admin<Workflow>("/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          blocks: input.blocks ?? [{ id: "trigger", name: "trigger", type: "trigger", config: {} }],
          edges: input.edges ?? [],
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
}

/** Replay a past run with the same trigger payload against the current workflow definition. */
export function useReplayRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      admin<{ runId: string; status: string; error?: string; replayedFromRunId: string }>(
        `/workflow-runs/${runId}/replay`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-runs", data.runId] });
    },
  });
}

/** Lookup agents for use in the WakeAgent config dropdown. */
export function useAgentsForWorkflow() {
  return useQuery({
    queryKey: ["workflow-editor", "agents"],
    queryFn: () => admin<{ agents: Array<{ id: string; name: string; role: string }> }>("/agents"),
    staleTime: 60_000,
  });
}

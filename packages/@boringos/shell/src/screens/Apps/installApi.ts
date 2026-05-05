// SPDX-License-Identifier: BUSL-1.1
//
// Typed client for the K10/K11 admin install/uninstall endpoints.
// Browse + InstallFromUrl call into this from the Approve handler.

export interface InstallApiOptions {
  baseUrl?: string;
  /**
   * Request headers (Authorization: Bearer …, X-Tenant-Id, etc.).
   * The host wires these from the active session.
   */
  headers?: Record<string, string>;
}

export interface InstallByUrlArgs {
  url: string;
}

export interface InstallByManifestArgs {
  manifest: unknown;
  bundleText?: string;
  manifestHash?: string;
  /** Server-trusted AppDefinition (rare from the UI; mostly tests). */
  definition?: unknown;
}

export type InstallArgs = InstallByUrlArgs | InstallByManifestArgs;

export interface InstallRecord {
  tenantId: string;
  appId: string;
  version: string;
  manifestHash: string | null;
  installedAt: string | Date;
}

export interface InstallApiError {
  status: number;
  error: string;
  detail?: string;
  issues?: unknown;
  warnings?: unknown;
}

export class InstallApiResponseError extends Error {
  readonly status: number;
  readonly payload: InstallApiError;
  constructor(payload: InstallApiError) {
    super(payload.error);
    this.name = "InstallApiResponseError";
    this.status = payload.status;
    this.payload = payload;
  }
}

export function createInstallApi(opts: InstallApiOptions = {}) {
  const base = opts.baseUrl ?? "";

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = {
      "content-type": "application/json",
      ...(opts.headers ?? {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      let body: InstallApiError;
      try {
        const json = await res.json();
        body = {
          status: res.status,
          error: typeof json?.error === "string" ? json.error : `HTTP ${res.status}`,
          detail: typeof json?.detail === "string" ? json.detail : undefined,
          issues: json?.issues,
          warnings: json?.warnings,
        };
      } catch {
        body = { status: res.status, error: `HTTP ${res.status}` };
      }
      throw new InstallApiResponseError(body);
    }
    return (await res.json()) as T;
  }

  return {
    async install(args: InstallArgs): Promise<InstallRecord> {
      return request<InstallRecord>("/api/admin/apps/install", {
        method: "POST",
        body: JSON.stringify(args),
      });
    },

    async list(): Promise<{ apps: Array<Record<string, unknown>> }> {
      return request<{ apps: Array<Record<string, unknown>> }>(
        "/api/admin/apps",
        { method: "GET" },
      );
    },

    async get(appId: string): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>(
        `/api/admin/apps/${encodeURIComponent(appId)}`,
        { method: "GET" },
      );
    },

    async uninstall(
      appId: string,
      mode: "soft" | "hard" = "soft",
      force = false,
    ): Promise<{ uninstalled: boolean; cascade: unknown[]; mode?: string }> {
      const url = `/api/admin/apps/${encodeURIComponent(appId)}?mode=${mode}${
        force ? "&force=true" : ""
      }`;
      return request<{ uninstalled: boolean; cascade: unknown[]; mode?: string }>(
        url,
        { method: "DELETE" },
      );
    },
  };
}

export type InstallApi = ReturnType<typeof createInstallApi>;

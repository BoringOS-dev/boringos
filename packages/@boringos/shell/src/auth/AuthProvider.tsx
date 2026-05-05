// SPDX-License-Identifier: BUSL-1.1
//
// AuthProvider — wraps the shell with session state.
// Lifted from boringos-crm/packages/web/src/lib/auth.tsx, adapted to:
//  - send `tenantName` (the framework's documented signup field) instead
//    of CRM's `orgName`
//  - generalize types (no CRM-specific assumptions)
//
// Talks to the framework's /api/auth/* endpoints (POST /signup, /login,
// /logout, GET /me with optional X-Tenant-Id header). Token + active
// tenant id persist in localStorage so a refresh keeps the session.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const AUTH_BASE = "/api/auth";

export interface TenantInfo {
  tenantId: string;
  tenantName: string;
  role: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  role: string;
  tenants: TenantInfo[];
}

export interface SignupOptions {
  name: string;
  email: string;
  password: string;
  /** New-tenant signup: creates the tenant and auto-seeds runtimes + copilot. */
  tenantName?: string;
  /** Existing-tenant signup: join via an invitation code. */
  inviteCode?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (opts: SignupOptions) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem("boringos.token"),
  );
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem("boringos.tenantId"),
  );
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(
    async (t: string, tenantId?: string | null) => {
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
        if (tenantId) headers["X-Tenant-Id"] = tenantId;

        const res = await fetch(`${AUTH_BASE}/me`, { headers });
        if (!res.ok) throw new Error("Invalid session");
        const data = (await res.json()) as AuthUser;

        setUser(data);
        if (data.tenantId) {
          window.localStorage.setItem("boringos.tenantId", data.tenantId);
          setActiveTenantId(data.tenantId);
        }
      } catch {
        window.localStorage.removeItem("boringos.token");
        window.localStorage.removeItem("boringos.tenantId");
        setToken(null);
        setActiveTenantId(null);
        setUser(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (token) {
      fetchMe(token, activeTenantId).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, fetchMe, activeTenantId]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Login failed");
    }
    const data = (await res.json()) as { token: string };
    window.localStorage.setItem("boringos.token", data.token);
    setToken(data.token);
    await fetchMe(data.token);
  };

  const signup = async (opts: SignupOptions) => {
    const res = await fetch(`${AUTH_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Signup failed");
    }
    const data = (await res.json()) as { token: string };
    window.localStorage.setItem("boringos.token", data.token);
    setToken(data.token);
    await fetchMe(data.token);
  };

  const logout = async () => {
    if (token) {
      await fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    window.localStorage.removeItem("boringos.token");
    window.localStorage.removeItem("boringos.tenantId");
    setToken(null);
    setActiveTenantId(null);
    setUser(null);
  };

  const switchTenant = async (tenantId: string) => {
    window.localStorage.setItem("boringos.tenantId", tenantId);
    setActiveTenantId(tenantId);
    if (token) await fetchMe(token, tenantId);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout, switchTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

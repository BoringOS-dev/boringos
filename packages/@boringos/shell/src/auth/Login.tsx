// SPDX-License-Identifier: BUSL-1.1
//
// Login screen. Lifted from boringos-crm/packages/web/src/pages/Login.tsx
// with shell branding (BoringOS) and plain Tailwind classes (A9 brings
// the BrandProvider that lets tenants customize this).

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider.js";
import { useBrand } from "../branding/BrandProvider.js";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15";

export function Login() {
  const { login } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-50 bg-cover bg-center"
      style={brand.loginBackground ? { backgroundImage: `url(${brand.loginBackground})` } : undefined}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {brand.logoUrl && (
            <img
              src={brand.logoUrl}
              alt={brand.productName}
              className="mx-auto mb-3 h-10 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {brand.productName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-sm text-slate-500">
            No account?{" "}
            <Link to="/signup" className="font-medium text-blue-600 hover:underline">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

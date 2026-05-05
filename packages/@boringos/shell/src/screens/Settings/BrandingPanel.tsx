// SPDX-License-Identifier: BUSL-1.1
//
// Settings → Branding panel.
// Admin-only edit of every Brand field plus a reset-to-defaults button.

import { useEffect, useState } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { useBrand } from "../../branding/BrandProvider.js";
import { BORINGOS_BRAND } from "../../branding/defaults.js";
import type { Brand } from "../../branding/types.js";

const FIELD_LABELS: Record<keyof Brand, string> = {
  productName: "Product name",
  productTagline: "Tagline",
  logoUrl: "Logo URL",
  faviconUrl: "Favicon URL",
  primaryColor: "Primary color",
  secondaryColor: "Secondary color",
  loginBackground: "Login background URL",
  emailFromName: "Email sender name",
};

const COLOR_FIELDS: (keyof Brand)[] = ["primaryColor", "secondaryColor"];

export function BrandingPanel() {
  const { user } = useAuth();
  const { brand, isLoading, setBrand, reset } = useBrand();
  const [draft, setDraft] = useState<Brand>(brand);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDraft(brand);
  }, [brand]);

  const isAdmin = user?.role === "admin";

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await setBrand(draft);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSaving(true);
    try {
      await reset();
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-xl">
        <p className="text-sm text-slate-500">
          Branding is admin-only. Ask a tenant admin to customize this.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">
        Override BoringOS branding for this tenant. Empty fields fall back to
        the BoringOS default. Saves take effect immediately across the shell.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {(Object.keys(FIELD_LABELS) as (keyof Brand)[]).map((key) => (
          <div key={key}>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">
              {FIELD_LABELS[key]}
            </label>
            <div className="flex items-center gap-2">
              <input
                type={COLOR_FIELDS.includes(key) ? "text" : "text"}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={BORINGOS_BRAND[key] || "—"}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
              />
              {COLOR_FIELDS.includes(key) && (
                <span
                  className="w-8 h-8 rounded border border-slate-200 shrink-0"
                  style={{ background: draft[key] || BORINGOS_BRAND[key] }}
                  title={`live preview of ${FIELD_LABELS[key]}`}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || isLoading}
          className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
        >
          Reset to BoringOS defaults
        </button>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs text-slate-400">
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || isLoading}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

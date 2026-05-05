// SPDX-License-Identifier: BUSL-1.1
//
// Settings — General + per-app panels via useSlot("settingsPanels").
// A9 BrandProvider lands the Branding tab.

import { useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { useSlot } from "../slots/context.js";
import { SlotRenderer } from "../slots/SlotRenderer.js";
import { EmptyState, ScreenBody, ScreenHeader } from "./_shared.js";

type Tab = { id: string; label: string };

export function Settings() {
  const { user } = useAuth();
  const panels = useSlot("settingsPanels");
  const tabs: Tab[] = [
    { id: "general", label: "General" },
    ...panels.map((p) => ({
      id: `app-${p.appId}-${p.slotId}`,
      label: p.slot.label,
    })),
  ];

  const [active, setActive] = useState<string>("general");
  const activePanel = panels.find(
    (p) => `app-${p.appId}-${p.slotId}` === active,
  );

  return (
    <>
      <ScreenHeader
        title="Settings"
        subtitle="Tenant configuration"
      />
      <div className="flex-1 flex overflow-hidden">
        <nav className="w-56 border-r border-slate-100 px-2 py-4 overflow-y-auto shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`block w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                active === t.id
                  ? "bg-slate-100 text-slate-900 font-medium"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}

          {panels.length === 0 && (
            <div className="mt-4 px-3 text-[11px] text-slate-400">
              Install apps to add their settings panels here.
            </div>
          )}
        </nav>

        <ScreenBody>
          {active === "general" && (
            <div className="max-w-xl space-y-6">
              <Field label="Tenant name" value={user?.tenantName ?? "—"} />
              <Field label="Your role" value={user?.role ?? "—"} />
              <Field label="Email" value={user?.email ?? "—"} />
              <p className="text-xs text-slate-400">
                Branding (product name, logo, colors) becomes editable here in TASK-A9.
              </p>
            </div>
          )}

          {activePanel && (
            <SlotRenderer
              family="settingsPanels"
              id={activePanel.slotId}
              appId={activePanel.appId}
              empty={
                <EmptyState
                  title="Panel did not render"
                  description={`The ${activePanel.appId} app contributed this panel but its component did not return any content.`}
                />
              }
            />
          )}
        </ScreenBody>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-900">{value}</div>
    </div>
  );
}

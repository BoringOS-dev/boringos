// SPDX-License-Identifier: BUSL-1.1
//
// Apps screen — the wp-admin Plugins page. Four tabs:
// Browse, Installed, Updates, Install from URL.
// The "killer screen" of v1, per the phase plan.

import { useState } from "react";

import { ScreenBody, ScreenHeader } from "../_shared.js";
import { Browse } from "./Browse.js";
import { Installed } from "./Installed.js";
import { Updates } from "./Updates.js";
import { InstallFromUrl } from "./InstallFromUrl.js";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "installed", label: "Installed" },
  { id: "updates", label: "Updates" },
  { id: "install-from-url", label: "Install from URL" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Apps() {
  const [tab, setTab] = useState<TabId>("browse");

  return (
    <>
      <ScreenHeader
        title="Apps"
        subtitle="Browse, install, and manage apps for your tenant"
      />
      <div className="px-8 border-b border-slate-100">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id
                  ? "border-blue-600 text-slate-900 font-medium"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <ScreenBody>
        {tab === "browse" && <Browse />}
        {tab === "installed" && <Installed />}
        {tab === "updates" && <Updates />}
        {tab === "install-from-url" && <InstallFromUrl />}
      </ScreenBody>
    </>
  );
}

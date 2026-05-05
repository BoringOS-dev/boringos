// SPDX-License-Identifier: BUSL-1.1
//
// Shell layout — sidebar + main content area + command bar.
// Lifted from boringos-crm/packages/web/src/components/Layout.tsx.
//
// Differences vs the CRM original:
// - No CRM-specific path check (the CRM version hid the CommandBar on
//   the /copilot route). The shell renders the CommandBar everywhere;
//   the Copilot screen (lands in A5) handles its own input separately.

import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";
import { CommandBar } from "./CommandBar.js";

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Outlet />
        <CommandBar />
      </main>
    </div>
  );
}

// SPDX-License-Identifier: BUSL-1.1
//
// Shell App — mounts the chrome (Layout/Sidebar/CommandBar) with a
// router. Routes are placeholders for A3; real screens land in A5.

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { Layout } from "./chrome/Layout.js";
import { SlotRegistryProvider } from "./slots/context.js";
import { SDK_VERSION } from "@boringos/app-sdk";

const PLACEHOLDER_ROUTES = [
  { path: "home", title: "Home" },
  { path: "copilot", title: "Copilot" },
  { path: "inbox", title: "Inbox" },
  { path: "tasks", title: "Tasks" },
  { path: "approvals", title: "Approvals" },
  { path: "agents", title: "Agents" },
  { path: "workflows", title: "Workflows" },
  { path: "drive", title: "Drive" },
  { path: "connectors", title: "Connectors" },
  { path: "apps", title: "Apps" },
  { path: "activity", title: "Activity" },
  { path: "team", title: "Team" },
  { path: "settings", title: "Settings" },
];

function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="flex-1 overflow-auto p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-2">
        Placeholder screen — real implementation lands in TASK-A5.
      </p>
      <p className="text-xs text-slate-400 mt-8 font-mono">
        @boringos/app-sdk {SDK_VERSION}
      </p>
    </div>
  );
}

export function App() {
  return (
    <SlotRegistryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/home" replace />} />
            {PLACEHOLDER_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<PlaceholderScreen title={r.title} />}
              />
            ))}
          </Route>
        </Routes>
      </BrowserRouter>
    </SlotRegistryProvider>
  );
}

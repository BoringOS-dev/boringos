// SPDX-License-Identifier: BUSL-1.1
//
// Shell App — public auth routes (Login, Signup) + auth-gated chrome
// hosting placeholder screens. Real screens land in A5.

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { Layout } from "./chrome/Layout.js";
import { SlotRegistryProvider } from "./slots/context.js";
import { AuthProvider, Login, RequireAuth, Signup } from "./auth/index.js";
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
    <AuthProvider>
      <SlotRegistryProvider>
        <BrowserRouter>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* Auth-gated chrome */}
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
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
    </AuthProvider>
  );
}

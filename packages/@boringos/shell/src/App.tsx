// SPDX-License-Identifier: BUSL-1.1
//
// Shell App — public auth routes (Login, Signup) + auth-gated chrome
// hosting the seven shell-mandatory screens (A5).
// Drive, Connectors, Apps, Activity, Team are still placeholders for now.

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { Layout } from "./chrome/Layout.js";
import { SlotRegistryProvider } from "./slots/context.js";
import { AuthProvider, Login, RequireAuth, Signup } from "./auth/index.js";
import { BoringOSClientProvider } from "./providers/BoringOSClientProvider.js";
import { BrandProvider } from "./branding/BrandProvider.js";
import {
  Agents,
  Copilot,
  Home,
  Inbox,
  Settings,
  Tasks,
  Workflows,
} from "./screens/index.js";
import { Apps } from "./screens/Apps/index.js";
import { SDK_VERSION } from "@boringos/app-sdk";

function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="flex-1 overflow-auto p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-2">
        Placeholder screen — landed in a later A-task.
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
      <BoringOSClientProvider>
        <BrandProvider>
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

                {/* Shell-mandatory screens (A5) */}
                <Route path="home" element={<Home />} />
                <Route path="copilot" element={<Copilot />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="agents" element={<Agents />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="settings" element={<Settings />} />

                {/* Still placeholders */}
                <Route path="approvals" element={<PlaceholderScreen title="Approvals" />} />
                <Route path="drive" element={<PlaceholderScreen title="Drive" />} />
                <Route path="connectors" element={<PlaceholderScreen title="Connectors" />} />
                <Route path="apps" element={<Apps />} />
                <Route path="activity" element={<PlaceholderScreen title="Activity" />} />
                <Route path="team" element={<PlaceholderScreen title="Team" />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SlotRegistryProvider>
        </BrandProvider>
      </BoringOSClientProvider>
    </AuthProvider>
  );
}

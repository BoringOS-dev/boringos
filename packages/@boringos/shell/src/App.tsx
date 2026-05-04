// SPDX-License-Identifier: BUSL-1.1
//
// Shell skeleton (TASK-A1).
//
// This file is intentionally minimal — it just confirms the toolchain
// works and the BoringOS shell boots. Real chrome (Layout, Sidebar,
// CommandBar) lands in TASK-A3 after the slot type contracts (A2) and
// the slot registry (A6) are in place.

import { SDK_VERSION } from "@boringos/app-sdk";

export function App() {
  return (
    <main
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        maxWidth: 720,
        margin: "4rem auto",
        padding: "0 1.5rem",
        color: "#0f172a",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: "2rem", fontWeight: 700, margin: 0 }}>
        BoringOS
      </h1>
      <p style={{ color: "#64748b", marginTop: "0.5rem", marginBottom: "2rem" }}>
        Shell skeleton — TASK-A1.
      </p>

      <p>
        This is the bare boot of <code>@boringos/shell</code>. Nothing useful
        renders here yet — the slot system (A2/A6), chrome (A3), auth (A4),
        screens (A5), and Apps screen (A7) all land in subsequent tasks.
      </p>

      <p style={{ color: "#64748b", marginTop: "2rem", fontSize: "0.875rem" }}>
        @boringos/app-sdk version: <code>{SDK_VERSION}</code>
      </p>
    </main>
  );
}

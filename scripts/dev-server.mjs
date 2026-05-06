// SPDX-License-Identifier: MIT
//
// Minimal Phase 1 dev server. Boots @boringos/core on port 3000 with
// embedded Postgres so the @boringos/shell SPA (port 5174) has a real
// /api/* backend to sign up + admin against.
//
// Phase 2's K-workstream replaces this with a proper @boringos/server
// package that wires the install pipeline + default-app provisioning
// into the boot path.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BoringOS } from "@boringos/core";
import { google } from "@boringos/connector-google";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const shellOrigin = process.env.BORINGOS_SHELL_URL ?? "http://localhost:5174";

const app = new BoringOS({
  database: { embedded: true, port: pgPort },
  shellOrigin,
  // Auto-install generic-triage + generic-replier on every fresh signup
  // (Phase 2 K8 + K9 wiring).
  defaultAppsDir: resolve(repoRoot, "apps"),
});

// Connectors. We register every connector unconditionally so the
// Connectors page always shows the catalog. If GOOGLE_CLIENT_ID isn't
// set, clicking Add → Authorize surfaces a clear "missing client_id"
// error from N2 rather than hiding the connector entirely.
app.connector(
  google({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  }),
);

const server = await app.listen(port);

console.log(`[dev-server] BoringOS listening at ${server.url}`);
console.log(`[dev-server] Health: ${server.url}/health`);
console.log(`[dev-server] Press Ctrl+C to stop`);

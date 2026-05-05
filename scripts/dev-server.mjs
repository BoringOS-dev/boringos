// SPDX-License-Identifier: MIT
//
// Minimal Phase 1 dev server. Boots @boringos/core on port 3000 with
// embedded Postgres so the @boringos/shell SPA (port 5174) has a real
// /api/* backend to sign up + admin against.
//
// Phase 2's K-workstream replaces this with a proper @boringos/server
// package that wires the install pipeline + default-app provisioning
// into the boot path.

import { BoringOS } from "@boringos/core";

const port = Number(process.env.PORT ?? 3030);
const pgPort = Number(process.env.PG_PORT ?? 5436);
const app = new BoringOS({
  database: { embedded: true, port: pgPort },
});
const server = await app.listen(port);

console.log(`[dev-server] BoringOS listening at ${server.url}`);
console.log(`[dev-server] Health: ${server.url}/health`);
console.log(`[dev-server] Press Ctrl+C to stop`);

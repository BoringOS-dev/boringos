// SPDX-License-Identifier: BUSL-1.1
//
// Bridges the shell's AuthProvider into @boringos/ui's BoringOSProvider.
// Constructs a BoringOSClient from the active session token + tenantId,
// memoized so it only changes when auth changes.

import { useMemo, type ReactNode } from "react";

import {
  BoringOSProvider,
  createBoringOSClient,
} from "@boringos/ui";

import { useAuth } from "../auth/AuthProvider.js";

export function BoringOSClientProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();

  const client = useMemo(
    () =>
      createBoringOSClient({
        url: "", // same-origin; vite proxies /api → framework server
        token: token ?? undefined,
        tenantId: user?.tenantId ?? undefined,
      }),
    [token, user?.tenantId],
  );

  return <BoringOSProvider client={client}>{children}</BoringOSProvider>;
}

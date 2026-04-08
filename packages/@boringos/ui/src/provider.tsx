import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoringOSClient } from "./client.js";

const BoringOSContext = createContext<BoringOSClient | null>(null);

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

export interface BoringOSProviderProps {
  client: BoringOSClient;
  queryClient?: QueryClient;
  children: ReactNode;
}

export function BoringOSProvider({ client, queryClient, children }: BoringOSProviderProps) {
  return (
    <QueryClientProvider client={queryClient ?? defaultQueryClient}>
      <BoringOSContext.Provider value={client}>
        {children}
      </BoringOSContext.Provider>
    </QueryClientProvider>
  );
}

export function useClient(): BoringOSClient {
  const client = useContext(BoringOSContext);
  if (!client) {
    throw new Error("useClient must be used within <BoringOSProvider>");
  }
  return client;
}

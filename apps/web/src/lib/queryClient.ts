import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query client (bible §10 — REST/imperative side of state). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

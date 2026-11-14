import { QueryClient } from "@tanstack/react-query";

export const DASHBOARD_QUERY_CACHE = {
  staleTime: 15 * 60_000,
  gcTime: 60 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      ...DASHBOARD_QUERY_CACHE,
      retry: 1,
    },
  },
});

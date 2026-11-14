import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_QUERY_CACHE, queryClient } from "../src/lib/query-client.ts";

test("reuses recently fetched dashboard data instead of issuing another request", async () => {
  const queryKey = ["cache-policy-test", crypto.randomUUID()];
  let requests = 0;
  try {
    queryClient.setQueryData(queryKey, "cached result", {
      updatedAt: Date.now() - 10 * 60_000,
    });

    const result = await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        requests++;
        return "network result";
      },
    });

    assert.equal(result, "cached result");
    assert.equal(requests, 0);
    assert.equal(DASHBOARD_QUERY_CACHE.staleTime, 15 * 60_000);
    assert.equal(DASHBOARD_QUERY_CACHE.gcTime, 60 * 60_000);
    assert.equal(DASHBOARD_QUERY_CACHE.refetchOnWindowFocus, false);
    assert.equal(DASHBOARD_QUERY_CACHE.refetchOnReconnect, false);
  } finally {
    queryClient.removeQueries({ queryKey, exact: true });
  }
});

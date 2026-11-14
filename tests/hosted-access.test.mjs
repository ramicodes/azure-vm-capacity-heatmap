import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

test("hosted access establishes scope before identity, retains it on polling, and clears cached data on session expiry", async (t) => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const vite = await createServer({
    configFile: false, root: path.dirname(directory),
    resolve: { alias: { "@": path.join(path.dirname(directory), "src") } },
    ssr: { noExternal: ["@microsoft/managed-apps"] },
    esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const { HostedAccess } = await vite.ssrLoadModule("/src/components/hosted-access.tsx");
  const { queryClient } = await vite.ssrLoadModule("/src/lib/query-client.ts");
  const { useAppStore } = await vite.ssrLoadModule("/src/lib/store.ts");
  const window = new Window({ url: "https://planner.example" });
  const saved = new Map(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    window.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const identity = "22222222-3333-4444-5555-666666666666";
  const subscriptionId = "00000000-1111-2222-3333-444444444444";
  const tenant = "11111111-2222-3333-4444-555555555555";
  globalThis.fetch = async () => new Response(JSON.stringify({ identity, subscriptionId, tenant }));
  await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(HostedAccess, null, createElement("p", null, "Authorized workspace")))));
  for (let count = 0; count < 30 && !container.textContent.includes("Authorized workspace"); count++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  assert.match(container.textContent, /Authorized workspace/);
  assert.equal(useAppStore.getState().azureIdentity, identity);
  assert.equal(useAppStore.getState().azureSubscriptionScope, subscriptionId);
  const generation = useAppStore.getState().azureSessionGeneration;
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["hosted-auth"] }); });
  assert.equal(useAppStore.getState().azureSessionGeneration, generation);
  queryClient.setQueryData(["arm", "old-session"], { private: "expired" });
  useAppStore.getState().setShortlistKeys(["fixture"]);
  globalThis.fetch = async () => new Response("expired", { status: 401 });
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["hosted-auth"] }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.doesNotMatch(container.textContent, /Authorized workspace/);
  assert.equal(useAppStore.getState().azureIdentity, null);
  assert.equal(useAppStore.getState().azureSubscriptionScope, null);
  assert.deepEqual(useAppStore.getState().shortlistKeys, []);
  assert.equal(queryClient.getQueryData(["arm", "old-session"]), undefined);
});

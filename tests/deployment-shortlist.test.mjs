import test from "node:test";
import assert from "node:assert/strict";
import { quotaGuidance } from "../src/lib/deployment-shortlist.ts";
import { useAppStore } from "../src/lib/store.ts";

const offer = { family: "standardDSv5Family", quotaVcpus: 4, status: "available", reason: null };
const snapshot = (regionalLimit, familyLimit) => ({
  state: "ready",
  data: { usages: [
    { name: "cores", used: 10, limit: regionalLimit },
    { name: "standarddsv5family", used: 4, limit: familyLimit },
  ], fetchedAt: new Date() },
});

test("quota guidance calculates additional shortfalls and total requested limits independently", () => {
  const text = quotaGuidance(offer, 3, snapshot(15, 8));
  assert.match(text, /regional: shortfall 7 vCPUs; request a total limit of at least 22/);
  assert.match(text, /family .*shortfall 8 vCPUs; request a total limit of at least 16/);
  assert.doesNotMatch(quotaGuidance(offer, 1, snapshot(100, 100)), /shortfall/);
});

test("restrictions, missing cores, missing metrics and read errors never imply quota sufficiency", () => {
  assert.match(quotaGuidance({ ...offer, status: "restricted", reason: "NotAvailableForSubscription" }, 1), /increase alone may not resolve/);
  assert.match(quotaGuidance(offer, 1), /Check quota/);
  assert.match(quotaGuidance(offer, 1, { state: "error" }), /sufficiency is unknown/);
  assert.match(quotaGuidance({ ...offer, quotaVcpus: null }, 1, snapshot(100, 100)), /unknown for this size/);
  assert.match(quotaGuidance(offer, 1, snapshot(null, null)), /metrics are incomplete/);
});

test("shortlists are bounded, deduplicated and cleared on subscription and identity changes", () => {
  const previous = useAppStore.getState();
  try {
    useAppStore.getState().setShortlistKeys(["A", "A", "B", "C", "D"]);
    assert.deepEqual(useAppStore.getState().shortlistKeys, ["A", "B", "C"]);
    useAppStore.getState().setSubscriptionId("another-subscription");
    assert.deepEqual(useAppStore.getState().shortlistKeys, []);
    useAppStore.getState().setShortlistKeys(["A"]);
    useAppStore.getState().setAzureIdentity(null);
    assert.deepEqual(useAppStore.getState().shortlistKeys, []);
    useAppStore.getState().setShortlistKeys(["A"]);
    useAppStore.getState().setAzureSubscriptionScope(null);
    assert.deepEqual(useAppStore.getState().shortlistKeys, []);
  } finally {
    useAppStore.setState(previous, true);
  }
});

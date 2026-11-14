import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionErrorInvalidates } from "../src/lib/cli-session-policy.ts";

test("only confirmed identity and authorization failures invalidate the local CLI session", () => {
  for (const code of ["cli-login", "cli-context", "context-changed", "session", "cli-token", "http-401"]) {
    assert.equal(sessionErrorInvalidates(code), true, code);
  }
  for (const code of ["cli-timeout", "cli-failed", "cli-unreachable", "bridge", "read-timeout", "busy", "http-403"]) {
    assert.equal(sessionErrorInvalidates(code), false, code);
  }
});

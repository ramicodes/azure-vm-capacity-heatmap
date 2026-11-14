const invalidSessionCodes = new Set([
  "cli-login", "cli-context", "context-changed", "session", "cli-token", "http-401",
]);

export function sessionErrorInvalidates(code: string): boolean {
  return invalidSessionCodes.has(code);
}

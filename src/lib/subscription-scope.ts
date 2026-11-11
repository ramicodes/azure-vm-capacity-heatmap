import { ArmReadError } from "./arm-http.ts";

export function subscriptionScope(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new ArmReadError("subscription-scope", "ARM_SUBSCRIPTION_ID must be an exact subscription GUID, or empty for unrestricted discovery.");
  }
  return value.trim().toLowerCase();
}

export function selectedSubscription(
  scope: string | null, selected: string | undefined, subscriptions: { id: string; state: string }[] | undefined,
): string | undefined {
  if (scope) return subscriptions?.some((item) => item.id.toLowerCase() === scope) ? scope : undefined;
  return selected ?? (subscriptions?.find((item) => item.state === "Enabled") ?? subscriptions?.[0])?.id;
}

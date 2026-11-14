import { armEndpoint, managedArmItems, ArmReadError, fetchArmList, type ArmRead, type ArmReadMetadata } from "./arm-http";
import { azureAccessToken, type ArmReadContext } from "./azure-session";
import { readCliArm } from "./cli-session";
import { readHostedArm } from "./hosted-session";

export async function readArmList(request: ArmRead, context: ArmReadContext, signal?: AbortSignal, onMetadata?: (metadata: ArmReadMetadata) => void): Promise<unknown[]> {
  if (!context.enabled) throw new ArmReadError("authentication", "Sign in to Azure before loading subscription data.");
  if (context.mode === "hosted") return readHostedArm(request, signal, onMetadata, context.cacheKey);
  if (context.mode === "cli") {
    if (!context.identity) throw new ArmReadError("session", "Connect the local Azure CLI session first.");
    return readCliArm(request, context.identity, signal, onMetadata);
  }
  if (context.mode === "standalone") {
    const identity = context.identity;
    if (!identity) throw new ArmReadError("authentication", "Sign in to Azure before loading subscription data.");
    return fetchArmList(request, () => azureAccessToken(identity), signal);
  }
  const { AzureResourceManagerService: service } = await import("../../generated");
  signal?.throwIfAborted();
  const { version } = armEndpoint(request);
  const result = request.kind === "subscriptions" ? await service.Subscriptions_List(version)
    : request.kind === "regions" ? await service.Subscriptions_ListLocations(request.subscriptionId, version)
    : await service.Provider_Resources_GetById(request.subscriptionId, "Microsoft.Compute",
      request.kind === "skus" ? "skus" : `locations/${encodeURIComponent(request.region)}/usages`, version);
  signal?.throwIfAborted();
  if (!result.success) throw result.error;
  return managedArmItems(result.data);
}

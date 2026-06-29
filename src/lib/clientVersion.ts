import {getRuntimeCodeSource} from "./runtimeCodeSource";
import {getCachedRuntimeReleaseIdentity} from "./runtimeReleaseIdentity";

export interface ClientVersionClaim {
  appVersion: string;
  sourceFingerprint: string;
  runtimeKind: string;
  runtimeLabel: string;
  runtimeCid?: string;
}

export function getClientVersionClaim(): ClientVersionClaim {
  const runtime = getRuntimeCodeSource();
  const releaseIdentity = getCachedRuntimeReleaseIdentity();
  return {
    appVersion: releaseIdentity.appVersion,
    sourceFingerprint: releaseIdentity.sourceFingerprint || 'ai-json-pending',
    runtimeKind: runtime.kind,
    runtimeLabel: runtime.label,
    ...(runtime.kind === 'ipfs' ? { runtimeCid: runtime.cid } : {}),
  };
}

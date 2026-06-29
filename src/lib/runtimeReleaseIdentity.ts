export interface RuntimeReleaseIdentity {
  appName: string;
  appVersion: string;
  gameClientCid: string;
  sourceIpfsCid: string;
  sourceFingerprint: string;
  sourceArchiveFile: string;
  archiveSha256: string;
}

const emptyIdentity: RuntimeReleaseIdentity = {
  appName: 'Fair Poker',
  appVersion: '0.1.0',
  gameClientCid: '',
  sourceIpfsCid: '',
  sourceFingerprint: '',
  sourceArchiveFile: '',
  archiveSha256: '',
};

let cachedIdentity: RuntimeReleaseIdentity = {...emptyIdentity};

export function getCachedRuntimeReleaseIdentity(): RuntimeReleaseIdentity {
  return cachedIdentity;
}

export async function loadRuntimeReleaseIdentity(): Promise<RuntimeReleaseIdentity> {
  if (typeof window === 'undefined') {
    return cachedIdentity;
  }
  const url = new URL('ai.json', window.location.href);
  url.searchParams.set('release_identity', String(Date.now()));
  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {'Accept': 'application/json'},
  });
  if (!response.ok) {
    throw new Error(`Release identity returned ${response.status}`);
  }
  const payload = await response.json();
  cachedIdentity = {
    appName: payload?.appName || emptyIdentity.appName,
    appVersion: payload?.appVersion || emptyIdentity.appVersion,
    gameClientCid: payload?.canonicalReleaseIdentity?.gameClientCid || '',
    sourceIpfsCid: payload?.currentSourceRelease?.ipfsCid || '',
    sourceFingerprint: payload?.currentSourceRelease?.sourceFingerprint || '',
    sourceArchiveFile: payload?.currentSourceRelease?.archiveFile || '',
    archiveSha256: payload?.currentSourceRelease?.archiveSha256 || '',
  };
  return cachedIdentity;
}

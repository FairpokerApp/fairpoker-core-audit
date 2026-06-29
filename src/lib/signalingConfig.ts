function cleanOptionalEnv(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function localDevelopmentSignalUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const host = window.location.hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return 'http://127.0.0.1:8787';
  }
  return undefined;
}

export function getSignalingUrl(): string | undefined {
  if (cleanOptionalEnv(process.env.REACT_APP_DISABLE_SIGNALING)?.toLowerCase() === 'true') {
    return undefined;
  }
  return cleanOptionalEnv(process.env.REACT_APP_SIGNALING_URL)
    ?? cleanOptionalEnv(process.env.REACT_APP_RELAY_WS_URL)
    ?? cleanOptionalEnv(process.env.REACT_APP_CLOUDFLARE_SIGNAL_URL)
    ?? localDevelopmentSignalUrl();
}

export function getOptionalBuildEnv(value: string | undefined): string | undefined {
  return cleanOptionalEnv(value);
}

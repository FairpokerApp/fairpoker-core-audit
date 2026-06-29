import {RelayPeerProfile} from "./CloudflareRelayTransport";

function compactPeerId(peerId: string) {
  return peerId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'NODE';
}

export function countryCodeToFlag(country: string | undefined) {
  const code = (country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return '🌐';
  }
  return Array.from(code)
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function displayCountry(country: string | undefined) {
  const code = (country || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : 'NET';
}

function compactIpSegment(ipSegment: string | undefined) {
  if (!ipSegment || ipSegment === 'unavailable' || ipSegment === 'masked') {
    return '';
  }
  if (ipSegment === 'local-test-network') {
    return 'LOCAL';
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\*$/.test(ipSegment)) {
    const [a, b] = ipSegment.split('.');
    return `${a}.${b}.*`;
  }
  if (ipSegment.includes(':')) {
    return `${ipSegment.split(':').filter(Boolean).slice(0, 2).join(':')}::*`;
  }
  return ipSegment;
}

export function buildNetworkIdentityLabel(
  peerId: string,
  profile: RelayPeerProfile | undefined,
  fallbackLabel?: string,
) {
  const compactIp = compactIpSegment(profile?.ipSegment);
  if (compactIp === 'LOCAL') {
    return `LOCAL · ${compactPeerId(peerId)}`;
  }
  if (compactIp) {
    return `${displayCountry(profile?.country)} · ${compactIp}`;
  }
  return fallbackLabel ?? `NET · ${compactPeerId(peerId)}`;
}

import {useEffect, useMemo, useState} from "react";
import {RelayPeerProfile} from "./CloudflareRelayTransport";

export type PeerProfileMap = Map<string, RelayPeerProfile>;

export type RiskLevel = 'low' | 'watch' | 'high' | 'critical';

export type RiskSignal = {
  label: string;
  labelEn: string;
  severity: RiskLevel;
  points: number;
  detail: string;
};

export type PeerRiskReport = {
  peerId: string;
  score: number;
  level: RiskLevel;
  title: string;
  subtitle: string;
  signals: RiskSignal[];
  profile?: RelayPeerProfile;
};

export type RoomRiskReport = {
  source?: string;
  generatedAt?: number;
  score: number;
  level: RiskLevel;
  title: string;
  subtitle: string;
  reports: PeerRiskReport[];
  missingCount: number;
};

const STORAGE_KEY = 'fairpoker:peerProfiles';

function loadStoredProfiles(): PeerProfileMap {
  if (typeof sessionStorage === 'undefined') {
    return new Map();
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    const profiles: RelayPeerProfile[] = JSON.parse(raw);
    return new Map(profiles.map(profile => [profile.peerId, profile]));
  } catch {
    return new Map();
  }
}

function storeProfiles(profiles: PeerProfileMap) {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(profiles.values())));
}

export function usePeerProfiles() {
  const [profiles, setProfiles] = useState<PeerProfileMap>(() => loadStoredProfiles());

  useEffect(() => {
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<{profiles?: RelayPeerProfile[]}>;
      const incoming = customEvent.detail?.profiles ?? [];
      if (incoming.length === 0) {
        return;
      }
      setProfiles(prev => {
        const next = new Map(prev);
        for (const profile of incoming) {
          next.set(profile.peerId, profile);
        }
        storeProfiles(next);
        return next;
      });
    };

    window.addEventListener('fairpoker:peer-profiles', listener);
    return () => window.removeEventListener('fairpoker:peer-profiles', listener);
  }, []);

  return profiles;
}

function isRoomRiskReport(value: unknown): value is RoomRiskReport {
  const report = value as RoomRiskReport | undefined;
  return Boolean(
    report
    && typeof report.score === 'number'
    && typeof report.level === 'string'
    && Array.isArray(report.reports),
  );
}

function known(value: string | undefined) {
  return Boolean(value && value !== 'unknown' && value !== 'unavailable');
}

function sameKnown(a: string | undefined, b: string | undefined) {
  return known(a) && a === b;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return 'critical';
  }
  if (score >= 50) {
    return 'high';
  }
  if (score >= 25) {
    return 'watch';
  }
  return 'low';
}

function riskTitle(level: RiskLevel) {
  switch (level) {
    case 'critical':
      return {title: '极高风险', subtitle: 'Critical risk'};
    case 'high':
      return {title: '高风险', subtitle: 'High risk'};
    case 'watch':
      return {title: '需留意', subtitle: 'Watch'};
    case 'low':
      return {title: '暂未发现明显风险', subtitle: 'Low risk'};
  }
}

function riskSignal(label: string, labelEn: string, severity: RiskLevel, points: number, detail: string): RiskSignal {
  return {label, labelEn, severity, points, detail};
}

function pendingPeerRisk(peerId: string, profiles: PeerProfileMap): PeerRiskReport {
  return {
    peerId,
    profile: profiles.get(peerId),
    score: 0,
    level: 'low',
    title: profiles.has(peerId) ? '等待评分' : '资料不可用',
    subtitle: profiles.has(peerId) ? 'Risk score pending' : 'Profile unavailable',
    signals: [{
      label: profiles.has(peerId) ? '评分尚未返回' : '未收到资料',
      labelEn: profiles.has(peerId) ? 'Safety score pending' : 'Profile unavailable',
      severity: 'low',
      points: 0,
      detail: profiles.has(peerId)
        ? '正在生成脱敏安全提示，前端只展示结果。 / Sanitized safety score pending.'
        : '未收到脱敏安全资料。 / Sanitized profile not received.',
    }],
  };
}

export function buildLocalPeerRiskReport(
  peerId: string,
  viewerPeerId: string | undefined,
  members: string[],
  profiles: PeerProfileMap,
): PeerRiskReport {
  const profile = profiles.get(peerId);
  const viewerProfile = viewerPeerId ? profiles.get(viewerPeerId) : undefined;
  if (!profile) {
    return pendingPeerRisk(peerId, profiles);
  }

  const signals: RiskSignal[] = [];
  if (viewerProfile && sameKnown(profile.networkFingerprint, viewerProfile.networkFingerprint)) {
    signals.push(riskSignal(
      '与你处于相近网络',
      'Nearby masked network',
      profile.ipConfidence === 'local' ? 'watch' : 'high',
      profile.ipConfidence === 'local' ? 18 : 34,
      '两名玩家落在同一脱敏网络指纹上，可能是同一 Wi-Fi、公司网络、机房出口或运营商出口重合。',
    ));
  }

  if (viewerProfile && sameKnown(profile.clientFingerprint, viewerProfile.clientFingerprint)) {
    signals.push(riskSignal(
      '设备环境高度相似',
      'Very similar device environment',
      'watch',
      18,
      '浏览器、系统、语言、时区、屏幕和硬件档位组合非常接近，单独不能定性，叠加网络重合时需要留意。',
    ));
  }

  if (viewerProfile && sameKnown(profile.timezone, viewerProfile.timezone) && sameKnown(profile.language, viewerProfile.language)) {
    signals.push(riskSignal(
      '语言与时区一致',
      'Same language and timezone',
      'low',
      6,
      '这是常见辅助线索，不会单独构成高风险。',
    ));
  }

  if (viewerProfile && sameKnown(profile.screenBucket, viewerProfile.screenBucket) && sameKnown(profile.hardware, viewerProfile.hardware)) {
    signals.push(riskSignal(
      '屏幕与硬件档位接近',
      'Similar screen and hardware bucket',
      'low',
      6,
      '该指标粒度较粗，只用于和其他信号交叉参考。',
    ));
  }

  if (known(profile.networkFingerprint)) {
    const sameNetworkPeers = members.filter((member) => (
      member !== peerId
      && profiles.get(member)?.networkFingerprint === profile.networkFingerprint
    ));
    if (sameNetworkPeers.length >= 2) {
      signals.push(riskSignal(
        '房间内多人同网络',
        'Multiple players share network',
        'high',
        26,
        '房间里至少三名玩家落在同一个脱敏网络指纹上，系统会把这类情况列入重点观察。',
      ));
    }
  }

  const score = clampScore(signals.reduce((sum, signal) => sum + signal.points, 0));
  const level = riskLevel(score);
  const title = riskTitle(level);
  return {
    peerId,
    profile,
    score,
    level,
    title: title.title,
    subtitle: title.subtitle,
    signals,
  };
}

function pendingRoomRisk(myPlayerId: string | undefined, members: string[], profiles: PeerProfileMap): RoomRiskReport {
  const opponents = members.filter(member => member !== myPlayerId);
  const reports = opponents.map(peerId => buildLocalPeerRiskReport(peerId, myPlayerId, members, profiles));
  const score = clampScore(reports.reduce((max, report) => Math.max(max, report.score), 0));
  const level = riskLevel(score);
  const title = riskTitle(level);
  return {
    source: 'local-profile-risk-engine',
    score,
    level,
    title: title.title,
    subtitle: title.subtitle,
    reports,
    missingCount: opponents.filter(peerId => !profiles.has(peerId)).length,
  };
}

export function getPeerRiskReport(
  peerId: string,
  roomRisk: RoomRiskReport | undefined,
  profiles: PeerProfileMap,
  viewerPeerId?: string,
  members: string[] = Array.from(profiles.keys()),
): PeerRiskReport {
  return roomRisk?.reports.find(report => report.peerId === peerId)
    ?? buildLocalPeerRiskReport(peerId, viewerPeerId, members, profiles);
}

function useBackendRoomRisk() {
  const [roomRisk, setRoomRisk] = useState<RoomRiskReport | undefined>();

  useEffect(() => {
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<{roomRisk?: unknown}>;
      if (isRoomRiskReport(customEvent.detail?.roomRisk)) {
        setRoomRisk(customEvent.detail.roomRisk);
      }
    };

    window.addEventListener('fairpoker:room-risk', listener);
    return () => window.removeEventListener('fairpoker:room-risk', listener);
  }, []);

  return roomRisk;
}

export function useRoomRisk(myPlayerId: string | undefined, members: string[]) {
  const profiles = usePeerProfiles();
  const backendRoomRisk = useBackendRoomRisk();
  return useMemo(() => ({
    profiles,
    roomRisk: backendRoomRisk ?? pendingRoomRisk(myPlayerId, members, profiles),
  }), [backendRoomRisk, members, myPlayerId, profiles]);
}

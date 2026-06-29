import React from "react";
import {
  getPeerRiskReport,
  PeerProfileMap,
  PeerRiskReport,
  RiskLevel,
  RoomRiskReport,
} from "../lib/peerRisk";
import {TranslationKey, useI18n, useLocalizedText} from "../lib/i18n";

function riskClass(level: RiskLevel) {
  return `risk-${level}`;
}

function riskCopy(level: RiskLevel): TranslationKey {
  switch (level) {
    case 'critical':
      return 'riskHigh';
    case 'high':
      return 'riskHigh';
    case 'watch':
      return 'riskMedium';
    case 'low':
      return 'riskLow';
  }
}

function Field(props: {label: string; value: React.ReactNode}) {
  return (
    <div className="risk-field">
      <span>{props.label}</span>
      <b>{props.value || '-'}</b>
    </div>
  );
}

function isLocalOrPrivateSegment(value: string | undefined) {
  return Boolean(
    value === 'local-test-network'
    || value?.startsWith('127.')
    || value?.startsWith('10.')
    || value?.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value ?? ''),
  );
}

function displayIpSegment(value: string | undefined, t: (key: TranslationKey) => string) {
  if (!value || value === 'unavailable') {
    return t('unavailable');
  }
  if (isLocalOrPrivateSegment(value)) {
    return t('localTestNetwork');
  }
  return value;
}

function reportTitle(report: Pick<PeerRiskReport | RoomRiskReport, 'title'>, t: (key: TranslationKey) => string, localize: (text: string | undefined) => string) {
  if (report.title === '等待评分') {
    return t('riskScorePendingTitle');
  }
  if (report.title === '资料不可用') {
    return t('riskProfileUnavailableTitle');
  }
  return localize(report.title);
}

function signalLabel(signal: PeerRiskReport['signals'][number], t: (key: TranslationKey) => string, localize: (text: string | undefined) => string) {
  if (signal.label === '评分尚未返回') {
    return t('riskScorePendingSignal');
  }
  if (signal.label === '未收到资料') {
    return t('riskProfileUnavailableSignal');
  }
  return localize(signal.label);
}

function signalDetail(detail: string, t: (key: TranslationKey) => string, localize: (text: string | undefined) => string) {
  if (detail.includes('正在生成脱敏安全提示')) {
    return t('riskScorePendingDetail');
  }
  if (detail.includes('未收到脱敏安全资料')) {
    return t('riskProfileUnavailableDetail');
  }
  return localize(detail);
}

export function PeerRiskDetails(props: {
  peerId: string;
  myPlayerId: string | undefined;
  members: string[];
  profiles: PeerProfileMap;
  roomRisk?: RoomRiskReport;
}) {
  const {t} = useI18n();
  const report = getPeerRiskReport(props.peerId, props.roomRisk, props.profiles, props.myPlayerId, props.members);
  const profile = report.profile;

  return (
    <div className="peer-risk-details" data-testid="peer-risk-details">
      <RiskHero report={report} />
      {profile ? (
        <div className="risk-profile-grid">
          <Field label={t('maskedIpSegment')} value={displayIpSegment(profile.ipSegment, t)} />
          <Field label={t('networkFingerprint')} value={profile.networkFingerprint} />
          <Field label={t('browser')} value={profile.browser} />
          <Field label={t('osDevice')} value={`${profile.os} / ${profile.device}`} />
          <Field label={t('languageTimezone')} value={`${profile.language} / ${profile.timezone}`} />
          <Field label={t('screenHardware')} value={`${profile.screenBucket} / ${profile.hardware}`} />
        </div>
      ) : (
        <div className="risk-unavailable-card" data-testid="risk-profile-unavailable">
          <strong>{t('riskNoProfileTitle')}</strong>
          <p>{t('riskNoProfileCopy')}</p>
        </div>
      )}
      <RiskSignals report={report} />
      <p className="risk-privacy-note">{t('riskPrivacyNote')}</p>
    </div>
  );
}

function RiskHero(props: {report: PeerRiskReport}) {
  const {t} = useI18n();
  const localize = useLocalizedText();
  return (
      <div className={`risk-hero ${riskClass(props.report.level)}`}>
      <div className="risk-score-ring" style={{'--score': props.report.score} as React.CSSProperties}>
        <strong>{props.report.score}</strong>
        <small>/100</small>
      </div>
      <div>
        <h4>
          <span>{reportTitle(props.report, t, localize)}</span>
        </h4>
        <p>{t(riskCopy(props.report.level))}</p>
      </div>
    </div>
  );
}

function RiskSignals(props: {report: PeerRiskReport}) {
  const {t} = useI18n();
  const localize = useLocalizedText();
  const signals = props.report.signals;
  return (
    <div className="risk-signals">
      <strong>{t('safetySignals')}</strong>
      {signals.length === 0 ? (
        <p className="risk-signal-empty">{t('riskNoOverlap')}</p>
      ) : signals.map((signal, index) => (
        <div className={`risk-signal ${riskClass(signal.severity)}`} key={`${signal.label}-${index}`}>
          <div>
            <span>{signalLabel(signal, t, localize)}</span>
          </div>
          <b>+{signal.points}</b>
          <p>{signalDetail(signal.detail, t, localize)}</p>
        </div>
      ))}
    </div>
  );
}

export default function CollusionRiskPanel(props: {
  myPlayerId: string | undefined;
  members: string[];
  profiles: PeerProfileMap;
  roomRisk: RoomRiskReport;
  compact?: boolean;
}) {
  const {t} = useI18n();
  const localize = useLocalizedText();
  const roomRisk = props.roomRisk;
  const worst = roomRisk.reports[0]
    ? [...roomRisk.reports].sort((a, b) => b.score - a.score)[0]
    : undefined;

  return (
    <section className={`collusion-risk-panel ${props.compact ? 'compact' : ''}`} data-testid="collusion-risk-panel">
      <div className={`risk-hero ${riskClass(roomRisk.level)}`}>
        <div className="risk-score-ring" style={{'--score': roomRisk.score} as React.CSSProperties}>
          <strong>{roomRisk.score}</strong>
          <small>/100</small>
        </div>
        <div>
          <h4>
            <span>{t('collusionRisk')}</span>
          </h4>
          <p>{reportTitle(roomRisk, t, localize)} · {t(riskCopy(roomRisk.level))}</p>
        </div>
      </div>
      <div className="risk-room-summary">
        <span>{props.members.length > 0 ? props.members.length - 1 : 0} {t('opponentsShort')}</span>
        <span>{roomRisk.missingCount} {t('riskMissing')}</span>
        <span>{worst ? t('riskMax', {score: worst.score}) : t('riskWaiting')}</span>
      </div>
      <p className="risk-explain">
        {props.compact
          ? t('riskCompactExplain')
          : t('riskFullExplain')}
      </p>
      {roomRisk.reports.length > 0 && (
        <div className="risk-peer-list">
          {roomRisk.reports.map(report => (
            <div className={`risk-peer-row ${riskClass(report.level)}`} key={report.peerId}>
              <span>{report.peerId.slice(0, 6)}...{report.peerId.slice(-4)}</span>
              <b>{report.score}</b>
              <small>{reportTitle(report, t, localize)}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

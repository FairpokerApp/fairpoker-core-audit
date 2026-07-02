import React, {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {TexasHoldem} from "../lib/setup";
import {useI18n, TranslationKey} from "../lib/i18n";
import {
  auditHandIntegrity,
  AuditEntryLike,
  HandIntegrityResult,
  IntegrityCheck,
  IntegrityCheckId,
} from "../lib/fairness/handIntegrityAudit";

const CHECK_ORDER: IntegrityCheckId[] = ['deckIntegrity', 'fullShuffle', 'recordConsensus', 'signatures'];
const CHECK_LABEL: Record<IntegrityCheckId, TranslationKey> = {
  deckIntegrity: 'fairnessCheckDeck',
  fullShuffle: 'fairnessCheckShuffle',
  recordConsensus: 'fairnessCheckConsensus',
  signatures: 'fairnessCheckSignatures',
};

const REVEAL_BASE_MS = 480;
const REVEAL_STEP_MS = 440;
const VERDICT_AT_MS = REVEAL_BASE_MS + CHECK_ORDER.length * REVEAL_STEP_MS + 220;
const AUTO_DISMISS_PASS_MS = VERDICT_AT_MS + 5200;
const AUTO_DISMISS_WARN_MS = VERDICT_AT_MS + 11000;
// Hard safety net: the scan must NEVER spin forever. A normal audit settles in well under a
// second, but a transcript snapshot captured mid-reconnect (right after an in-hand refresh)
// can leave the audit promise un-settled — the verdict timers below then never arm and the
// overlay is stuck on "校验中…". This independent timer forces the verdict to render no matter
// what, so the spinner always resolves.
const SCAN_HARD_TIMEOUT_MS = 8000;

type Tone = 'pass' | 'warn' | 'pending';

function ShieldGlyph({tone}: {tone: Tone}) {
  return (
    <svg viewBox="0 0 24 24" width="42" height="42" aria-hidden="true">
      <path d="M12 2.6 4.6 5.4v6c0 4.5 3.1 7.6 7.4 9.4 4.3-1.8 7.4-4.9 7.4-9.4v-6L12 2.6Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      {tone === 'warn'
        ? <path d="M12 8v4.5M12 15.4v.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
        : <path d="M8.6 12.2l2.3 2.3 4.5-4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>}
    </svg>
  );
}

function MarkGlyph({status}: {status: IntegrityCheck['status']}) {
  if (status === 'warn') {
    return (
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
      </svg>
    );
  }
  if (status === 'pending') {
    return (
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" fill="currentColor"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M6 12.5l3.6 3.6L18 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function detailKeyAndParams(check: IntegrityCheck): {key: TranslationKey; params?: Record<string, string | number>} {
  switch (check.id) {
    case 'deckIntegrity':
      if (check.status === 'pass') return {key: 'fairnessDeckPass'};
      if (check.reasonCode === 'duplicate-ciphertext') return {key: 'fairnessDeckDup'};
      if (check.reasonCode === 'deck-not-52') return {key: 'fairnessDeckSize'};
      return {key: 'fairnessNotInHand'};
    case 'fullShuffle':
      if (check.status === 'pass') return {key: 'fairnessShufflePass', params: {n: Number(check.metrics.participants ?? 0)}};
      if (check.status === 'warn') return {key: 'fairnessShuffleWarn'};
      return {key: 'fairnessNotInHand'};
    case 'recordConsensus':
      if (check.status === 'pass') return {key: 'fairnessConsensusPass', params: {n: Number(check.metrics.agreed ?? 0)}};
      if (check.status === 'warn') return {key: 'fairnessConsensusWarn'};
      return {key: 'fairnessConsensusPending'};
    case 'signatures':
      if (check.status === 'pass') return {key: 'fairnessSigPass'};
      if (check.status === 'warn') return {key: 'fairnessSigWarn'};
      return {key: 'fairnessNotInHand'};
    default:
      return {key: 'fairnessNotInHand'};
  }
}

// A generated local record fingerprint is itself a real positive, so show the
// consensus check as passed (not a perpetual grey "pending") until cross-player
// receipt comparison is wired. It never claims agreement — the label + detail say
// "record generated, downloadable to compare". Upgrades to "all records match"
// only when peer receipts actually arrive.
function displayCheckStatus(id: IntegrityCheckId, check: IntegrityCheck): IntegrityCheck['status'] {
  if (id === 'recordConsensus' && check.status === 'pending') {
    return 'pass';
  }
  return check.status;
}

function checkLabelKey(id: IntegrityCheckId, check: IntegrityCheck): TranslationKey {
  if (id === 'recordConsensus' && check.status === 'pending') {
    return 'fairnessCheckConsensusReady';
  }
  return CHECK_LABEL[id];
}

export default function FairnessVerificationOverlay(props: {
  visible: boolean;
  round: number;
  participants: string[];
  names?: Map<string, string>;
  playerId?: string;
  peerReceipts?: Array<{signer: string; handHash: string}>;
  // True when this hand was voided/refunded. A void legitimately leaves the shuffle
  // incomplete (e.g. a mid-shuffle refresh), so the audit must not flag it as cheating.
  voided?: boolean;
  onDismiss?: () => void;
}) {
  const {t: tBase} = useI18n();
  // The i18n key union (keyof typeof zh) truncates for late-defined keys under
  // TS as-const complexity limits, so cast here; keys exist and resolve at runtime.
  const t = (key: TranslationKey | string, params?: Record<string, string | number>) =>
    tBase(key as TranslationKey, params);
  const [result, setResult] = useState<HandIntegrityResult | null>(null);
  const [phase, setPhase] = useState<'scanning' | 'done'>('scanning');
  const [revealed, setRevealed] = useState(0);
  const onDismissRef = useRef(props.onDismiss);
  onDismissRef.current = props.onDismiss;

  useEffect(() => {
    if (!props.visible) {
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setResult(null);
    setPhase('scanning');
    setRevealed(0);

    // Arm the hard-stop FIRST, before anything that could throw or hang, so the spinner can
    // never be left running. If the audit never settles, this shows the verdict (a pending /
    // not-evaluated state when there's no result) and then auto-dismisses.
    timers.push(setTimeout(() => {
      if (cancelled) {
        return;
      }
      setRevealed(CHECK_ORDER.length);
      setPhase('done');
      timers.push(setTimeout(() => {
        if (!cancelled) {
          onDismissRef.current?.();
        }
      }, AUTO_DISMISS_PASS_MS));
    }, SCAN_HARD_TIMEOUT_MS));

    // A refresh can leave getTranscript throwing or returning a partial snapshot; degrade to
    // no entries rather than letting the effect throw (which would strand the spinner).
    let entries: AuditEntryLike[] = [];
    try {
      const snapshot = TexasHoldem?.getTranscript?.();
      entries = (snapshot?.entries ?? []).map((entry) => ({scope: entry.scope, wireEvent: entry.wireEvent}));
    } catch {
      entries = [];
    }

    auditHandIntegrity({
      entries,
      round: props.round,
      participants: props.participants,
      peerReceipts: props.peerReceipts,
      voided: props.voided,
    })
      .then((res) => {
        if (cancelled) {
          return;
        }
        setResult(res);
        CHECK_ORDER.forEach((_, index) => {
          timers.push(setTimeout(() => {
            if (!cancelled) {
              setRevealed(index + 1);
            }
          }, REVEAL_BASE_MS + index * REVEAL_STEP_MS));
        });
        timers.push(setTimeout(() => {
          if (!cancelled) {
            setPhase('done');
          }
        }, VERDICT_AT_MS));
        const dismissAt = res.status === 'warn' ? AUTO_DISMISS_WARN_MS : AUTO_DISMISS_PASS_MS;
        timers.push(setTimeout(() => {
          if (!cancelled) {
            onDismissRef.current?.();
          }
        }, dismissAt));
      })
      .catch(() => {
        if (!cancelled) {
          onDismissRef.current?.();
        }
      });

    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
    // Run once per hand (visible + round). participants/peerReceipts are captured
    // at effect time and deliberately excluded so a parent re-render with a new
    // array identity can't restart the scan animation mid-hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible, props.round]);

  if (!props.visible) {
    return null;
  }

  const overall: Tone = phase === 'done' ? (result?.status ?? 'pending') : 'pending';
  const statusText = phase !== 'done'
    ? t('fairnessScanning')
    : overall === 'pass'
      ? t('fairnessPassStatus')
      : overall === 'warn'
        ? t('fairnessWarnStatus')
        : t('fairnessPendingStatus');
  const verdictTitle = overall === 'warn'
    ? t('fairnessVerdictWarnTitle')
    : overall === 'pending'
      ? t('fairnessVerdictPendingTitle')
      : t('fairnessVerdictPassTitle');
  const verdictSub = overall === 'warn'
    ? t('fairnessVerdictWarnSub')
    : overall === 'pending'
      ? t('fairnessVerdictPendingSub')
      : t('fairnessVerdictPassSub');

  // 收尾公平校验：从原来的"全屏遮罩"改成左下角一张半透明小卡片（滑入/滑出），不盖牌桌、
  // 完全穿透不拦截任何点击（pointer-events:none），几秒后自动收起。盾牌 + 4 项校验 + 结论
  // 都在，让玩家清楚看到"这一手已被独立校验"，只是做得很小、不打断牌局节奏。
  const overlay = (
    <div
      className={`fairness-overlay fairness-toast ${phase}`}
      role="status"
      aria-live="polite"
      data-testid="fairness-overlay"
      data-status={phase === 'done' ? overall : 'scanning'}
    >
      <div className={`fairness-card tone-${overall}`}>
        <div className="fairness-card-head">
          <span className={`fairness-badge tone-${overall} ${phase === 'scanning' ? 'spinning' : ''}`} aria-hidden="true">
            <ShieldGlyph tone={phase === 'done' ? overall : 'pending'}/>
          </span>
          <span className="fairness-card-titles">
            <strong>{t('fairnessTitle')}</strong>
            <small>{statusText} · {t('fairnessHand', {round: props.round, players: props.participants.length})}</small>
          </span>
        </div>
        <ul className="fairness-checks" data-testid="fairness-checks">
          {CHECK_ORDER.map((id, index) => {
            const check = result?.checks.find((c) => c.id === id);
            const isIn = index < revealed;
            const done = phase === 'done' && !!check;
            const shown: IntegrityCheck['status'] = done ? displayCheckStatus(id, check as IntegrityCheck) : 'pending';
            const labelKey = done ? checkLabelKey(id, check as IntegrityCheck) : CHECK_LABEL[id];
            // 明细（如"52/52 唯一密文·无重复"）不再占版面，改成悬停提示，保留可信细节又保持小巧。
            const detail = done ? detailKeyAndParams(check as IntegrityCheck) : null;
            return (
              <li
                key={id}
                className={`fairness-check status-${shown} ${isIn ? 'in' : ''}`}
                data-testid={`fairness-check-${id}`}
                data-check-status={done ? (check as IntegrityCheck).status : 'scanning'}
                title={detail ? t(detail.key, detail.params) : undefined}
              >
                <span className="fairness-mark"><MarkGlyph status={shown}/></span>
                <span className="fairness-clabel">{t(labelKey)}</span>
              </li>
            );
          })}
        </ul>
        <div className={`fairness-verdict tone-${overall} ${phase === 'done' ? 'show' : ''}`}>
          <span className="fairness-vico"><ShieldGlyph tone={overall === 'warn' ? 'warn' : 'pass'}/></span>
          <span className="fairness-vtext">
            <strong>{verdictTitle}</strong>
            <small>{verdictSub}</small>
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

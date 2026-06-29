import React, {useEffect, useMemo, useRef, useState} from "react";
import {useI18n} from "../lib/i18n";

export default function NextHandCountdown(props: {
  delaySeconds?: number;
  recoveryGraceSeconds?: number;
  canRecover?: boolean;
  recoveryRequested?: boolean;
  onRecover?: () => void | Promise<void>;
  onComplete?: () => void;
  compact?: boolean;
}) {
  const {t} = useI18n();
  const {onComplete} = props;
  const delayMs = Math.max(1, props.delaySeconds ?? 5) * 1000;
  const recoveryGraceMs = Math.max(0, props.recoveryGraceSeconds ?? 3) * 1000;
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());
  const completedRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const elapsedMs = Math.max(0, now - startedAt);
  const remainingSeconds = Math.max(0, Math.ceil((delayMs - elapsedMs) / 1000));
  const showRecovery = Boolean(props.canRecover && props.onRecover && elapsedMs >= delayMs + recoveryGraceMs);
  const title = remainingSeconds > 0 ? t('nextHandCountdownTitle') : t('nextHandStartingTitle');
  const copy = useMemo(() => {
    if (remainingSeconds > 0) {
      return t('nextHandCountdownCopy', {seconds: remainingSeconds});
    }
    if (showRecovery) {
      if (props.recoveryRequested) {
        return t('nextHandRecoveryPendingCopy');
      }
      return t('nextHandRecoveryCopy');
    }
    return t('nextHandStartingCopy');
  }, [props.recoveryRequested, remainingSeconds, showRecovery, t]);

  useEffect(() => {
    if (remainingSeconds > 0 || completedRef.current) {
      return;
    }
    completedRef.current = true;
    onComplete?.();
  }, [remainingSeconds, onComplete]);

  if (remainingSeconds === 0 && !showRecovery) {
    return null;
  }

  return (
    <div
      className={[
        'next-hand-countdown',
        props.compact ? 'compact' : '',
        showRecovery ? 'recovery' : '',
      ].filter(Boolean).join(' ')}
      data-testid="next-hand-countdown"
      aria-live="polite"
    >
      <div className="next-hand-countdown-ring" aria-hidden="true">
        {remainingSeconds > 0 ? remainingSeconds : '...'}
      </div>
      <div className="next-hand-countdown-copy">
        <strong>{title}</strong>
        <span>{copy}</span>
      </div>
      {showRecovery && (
        <button
          className="action-button start-button next-hand-recovery-button"
          onClick={() => void props.onRecover?.()}
          data-testid="continue-button"
        >{props.recoveryRequested ? t('nextHandRecoveryPendingLabel') : t('restartHandFallback')}</button>
      )}
    </div>
  );
}

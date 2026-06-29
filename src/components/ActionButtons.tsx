import React, {useCallback, useEffect, useState} from "react";
import ActionButton from "./ActionButton";
import {useI18n} from "../lib/i18n";

export default function ActionButtons(props: {
  potAmount: number;
  bankroll: number;
  callAmount: number;
  stateKey?: string;
  children?: React.ReactNode;
  fireBet: (amount: number) => Promise<void> | void;
  fireFold: () => Promise<void> | void;
}) {
  const {t} = useI18n();
  const {
    fireBet,
    fireFold,
    bankroll,
    potAmount,
    callAmount,
    stateKey,
    children,
  } = props;
  const [notice, setNotice] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsSubmitting(false);
  }, [stateKey]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(undefined), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const submitAction = useCallback(async (action: () => Promise<void> | void) => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setNotice(undefined);
    try {
      await action();
    } catch (error) {
      console.error('Unable to submit poker action.', error);
      setNotice(t('actionSubmitFailed'));
      setIsSubmitting(false);
    }
  }, [isSubmitting, t]);

  const attemptBet = useCallback((amount: number) => {
    if (amount > bankroll) {
      setNotice(t('needAmount', {amount}));
      return;
    }
    void submitAction(() => fireBet(amount));
  }, [bankroll, fireBet, submitAction, t]);

  const checkOrCall = useCallback(() => {
    attemptBet(callAmount);
  }, [attemptBet, callAmount]);
  const raiseUpToHalfPot =  useCallback(() => {
    attemptBet(Math.ceil(potAmount / 2));
  }, [attemptBet, potAmount]);
  const raiseUpToPot =  useCallback(() => {
    attemptBet(potAmount);
  }, [attemptBet, potAmount]);
  const raiseUpToTwicePot =  useCallback(() => {
    attemptBet(potAmount * 2);
  }, [attemptBet, potAmount]);
  const allIn =  useCallback(() => {
    if (bankroll <= 0) {
      setNotice(t('insufficientChips'));
      return;
    }
    void submitAction(() => fireBet(bankroll));
  }, [fireBet, bankroll, submitAction, t]);

  const fold = useCallback(() => {
    void submitAction(fireFold);
  }, [fireFold, submitAction]);
  return (
    <>
    {children}
    {notice && <div className="action-notice" role="status" data-testid="action-notice">{notice}</div>}
    <div className="actions">
      <ActionButton className="action-check-or-call" onClick={checkOrCall} data-testid="check-or-call-action-button" disabled={isSubmitting}>
        {
          callAmount === 0 ? <>{t('check')}</> : <>{t('call')}<small>${callAmount}</small></>
        }
      </ActionButton>
      {
        callAmount <= Math.ceil(potAmount / 2) && <ActionButton className="action-raise" onClick={raiseUpToHalfPot} data-testid="raise-half-pot-action-button" disabled={isSubmitting}>{t('raise')}<small>1/2 POT</small></ActionButton>
      }
      {
        callAmount <= potAmount && <ActionButton className="action-raise" onClick={raiseUpToPot} data-testid="raise-1-pot-action-button" disabled={isSubmitting}>{t('raise')}<small>1 POT</small></ActionButton>
      }
      {
        callAmount <= (potAmount * 2) &&  <ActionButton className="action-raise" onClick={raiseUpToTwicePot} data-testid="raise-twice-pot-action-button" disabled={isSubmitting}>{t('raise')}<small>2 POT</small></ActionButton>
      }
      <ActionButton className="action-all-in" onClick={allIn} data-testid="all-in-action-button" disabled={isSubmitting}>{t('allIn')}</ActionButton>
      {
        callAmount > 0 && <ActionButton className="action-fold" onClick={fold} data-testid="fold-action-button" disabled={isSubmitting}>{t('fold')}</ActionButton>
      }
    </div>
    </>
  );
}

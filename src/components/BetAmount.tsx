import ChipImage from "./ChipImage";
import React from "react";
import {useI18n} from "../lib/i18n";

export default function BetAmount(props: {
  playerId: string;
  actionsDone: Map<string, number | string>;
}) {
  const {t} = useI18n();
  const actionDone = props.actionsDone.get(props.playerId);
  const actionLabel = (() => {
    switch (actionDone) {
      case 'fold':
        return t('fold');
      case 'all-in':
        return t('allIn');
      case 'check':
        return t('check');
      default:
        return actionDone;
    }
  })();
  return (actionDone) ? (
    <div className="bet-amount" data-testid="bet-amount">
      {
        (typeof actionDone !== 'string')
          ? <><ChipImage/> ${actionDone}</>
          : actionLabel
      }
    </div>
  ) : <></>;
}

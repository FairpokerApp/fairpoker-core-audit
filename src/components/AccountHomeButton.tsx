import React from "react";
import {useI18n} from "../lib/i18n";
import fairPokerMark from "../assets/fairpoker-mark.svg";
import {buildGameLobbyUrl} from "../lib/tableLobby";

function FairPokerHomeIcon() {
  return (
    <span className="account-home-logo" aria-hidden="true">
      <img src={fairPokerMark} alt="" />
    </span>
  );
}

export default function AccountHomeButton() {
  const {t} = useI18n();
  const goHome = () => {
    window.location.assign(buildGameLobbyUrl());
  };

  return (
    <button
      className="account-home-button"
      type="button"
      onClick={goHome}
      title={t('returnToGameLobby')}
      aria-label={t('returnToGameLobby')}
      data-testid="account-home-button"
    >
      <FairPokerHomeIcon />
    </button>
  );
}

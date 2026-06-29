import React from "react";
import {useI18n} from "../lib/i18n";
import {buildNewTableUrl} from "./Staging";

export default function RestartGameButton() {
  const {t} = useI18n();

  const handleClick = () => {
    if (window.confirm(t('restartGameConfirm'))) {
      window.location.href = buildNewTableUrl();
    }
  };

  return (
    <button
      type="button"
      className="restart-game-button"
      onClick={handleClick}
      title={t('restartMatch')}
      aria-label={t('restartMatch')}
      data-testid="restart-game-button"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 4v5h-5" />
      </svg>
    </button>
  );
}

import React, {useState} from "react";
import {useI18n} from "../lib/i18n";

export default function LeaveSeatButton(props: {
  disabled?: boolean;
  onLeaveSeat: () => Promise<void>;
}) {
  const {t} = useI18n();
  const [leaving, setLeaving] = useState(false);
  const disabled = props.disabled || leaving;

  const handleClick = async () => {
    if (disabled) {
      return;
    }
    setLeaving(true);
    try {
      await props.onLeaveSeat();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <button
      type="button"
      className="leave-seat-button"
      onClick={handleClick}
      disabled={disabled}
      title={t('leaveSeat')}
      aria-label={t('leaveSeat')}
      data-testid="leave-seat-button"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" />
        <path d="M14 8l4 4-4 4" />
        <path d="M18 12H9" />
      </svg>
    </button>
  );
}

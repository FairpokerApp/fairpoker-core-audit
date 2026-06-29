import React, {useCallback, useMemo, useState} from "react";
import {HostId, TableId} from "../lib/setup";
import {useTimeout} from "../lib/utils";
import {buildRoomLink, copyTextToClipboard} from "./Invitation";
import {useI18n} from "../lib/i18n";

export default function FloatingInviteButton(props: {
  playerId: string | undefined;
}) {
  const {playerId} = props;
  const {t} = useI18n();
  const [copied, setCopied] = useState(false);
  const inviteLink = useMemo(() => {
    if (!playerId) {
      return undefined;
    }
    return buildRoomLink(HostId || playerId, TableId);
  }, [playerId]);

  useTimeout(useCallback(() => {
    if (copied) {
      setCopied(false);
    }
  }, [copied]), 2200);

  if (!inviteLink) {
    return null;
  }

  return (
    <button
      className={copied ? 'floating-invite-button copied' : 'floating-invite-button'}
      type="button"
      onClick={() => {
        copyTextToClipboard(inviteLink).then(() => setCopied(true)).catch(e => console.error('Failed to copy invite link', e));
      }}
      title={t('copyInvite')}
      aria-label={t('copyInvite')}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
      </svg>
      {copied && (
        <span className="floating-invite-copy">
          <b>{t('inviteCopied')}</b>
        </span>
      )}
    </button>
  );
}

import DataTestIdAttributes from "../lib/types";
import {HostId, TableId} from "../lib/setup";
import React, {useCallback, useRef, useState} from "react";
import {useTimeout} from "../lib/utils";
import {useI18n} from "../lib/i18n";

const OFFICIAL_INVITE_URL = 'https://fairpoker.app/';
const LOCAL_INVITE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function inviteBaseUrl(currentUrl: URL) {
  if (LOCAL_INVITE_HOSTS.has(currentUrl.hostname)) {
    const url = new URL(currentUrl.origin + currentUrl.pathname);
    url.searchParams.set('entry', 'game');
    return url;
  }
  return new URL(OFFICIAL_INVITE_URL);
}

export function buildRoomLink(hostPlayerId: string, tableIdOrCurrentHref?: string, currentHref = window.location.href) {
  const secondArgIsHref = !!tableIdOrCurrentHref && /^https?:\/\//.test(tableIdOrCurrentHref);
  const tableId = secondArgIsHref ? undefined : tableIdOrCurrentHref;
  const href = secondArgIsHref ? tableIdOrCurrentHref : currentHref;
  const currentUrl = new URL(href);
  const roomId = hostPlayerId || currentUrl.searchParams.get('gameRoomId') || '';
  const table = tableId || currentUrl.searchParams.get('tableId') || '';
  const url = inviteBaseUrl(currentUrl);
  if (roomId) {
    url.searchParams.set('gameRoomId', roomId);
  }
  if (table) {
    url.searchParams.set('tableId', table);
  }
  return url.toString();
}

export function copyTextToClipboard(text: string) {
  return navigator.clipboard.writeText(text);
}

export default function Invitation(props: DataTestIdAttributes & {
  hostPlayerId: string;
}) {
  const {t} = useI18n();
  const roomLink = buildRoomLink(HostId || props.hostPlayerId, TableId);

  const [copied, setCopied] = useState(false);
  useTimeout(useCallback(() => {
    if (copied) {
      setCopied(false);
    }
  }, [copied]), 3000);

  const roomLinkInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="invitation input-group" data-testid={props['data-testid'] ?? 'invitation'}>
      <label>{t('inviteLabel')}</label>
      <input
        ref={roomLinkInputRef}
        type="text"
        readOnly={true}
        value={roomLink}
        data-testid="room-link"
        onFocus={(e) => e.target.setSelectionRange(0, e.target.value.length)}
      />
      <button className="copy-link-button" data-testid="copy-link-button" onClick={() => {
        roomLinkInputRef.current?.focus();
        copyTextToClipboard(roomLink).then(() => setCopied(true));
      }}>{copied ? <b>{t('inviteCopied')}</b> : t('copyInviteShort')}</button>
    </div>
  );
}

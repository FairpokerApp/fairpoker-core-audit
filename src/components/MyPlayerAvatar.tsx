import React, {useCallback, useEffect, useState} from "react";
import PlayerAvatar from "./PlayerAvatar";
import {getAuthDisplayName} from "../lib/auth";
import {useI18n} from "../lib/i18n";
import {GameAudioControls} from "../lib/useGameAudio";

export function buildDevicePlayerName(playerId: string, username = getAuthDisplayName(), memberPrefix = '会员') {
  if (username) {
    return username;
  }
  const fingerprint = playerId.slice(-4).toUpperCase();
  return `${memberPrefix} · ${fingerprint}`;
}

export default function MyPlayerAvatar(props: {
  playerId: string | undefined;
  names: Map<string, string>;
  setMyName: (name: string) => void;
  connectionStatus?: 'good' | 'warn' | 'offline';
  turnTimer?: {
    active: boolean;
    timeoutSeconds?: number;
    timerKey: string;
    audio?: Pick<GameAudioControls, 'play'>;
  };
}) {
  const {t} = useI18n();
  const {
    playerId,
    names,
    setMyName,
  } = props;

  const [nameInputValue, setNameInputValue] = useState('');

  const handleInputChange: React.ChangeEventHandler<HTMLInputElement> = useCallback(e => {
    setNameInputValue(e.target.value);
  }, []);

  const handleInputKeyUp: React.KeyboardEventHandler<HTMLInputElement>  = useCallback(e => {
    if (e.key === 'Enter' && nameInputValue) {
      setChangingName(false);
      setMyName(nameInputValue);
    }
  }, [setMyName, nameInputValue]);

  const [changingName, setChangingName] = useState<boolean>(false);

  const playerName = playerId ? names.get(playerId) : undefined;
  const devicePlayerName = playerId ? buildDevicePlayerName(playerId, getAuthDisplayName(), t('memberNamePrefix')) : '';

  useEffect(() => {
    if (playerId && !playerName && !changingName) {
      setMyName(devicePlayerName);
    }
  }, [changingName, devicePlayerName, playerId, playerName, setMyName]);

  if (!playerId) {
    return <></>;
  }

  if (playerName && !changingName) {
    return (
      <PlayerAvatar playerId={playerId} connectionStatus={props.connectionStatus} turnTimer={props.turnTimer}>
        <span className="clickable" onClick={() => setChangingName(true)}>{playerName}</span>
      </PlayerAvatar>
    );
  }

  if (!changingName) {
    return (
      <PlayerAvatar playerId={playerId} connectionStatus={props.connectionStatus} turnTimer={props.turnTimer} data-testid="my-player-avatar">
        <span
          className="clickable"
          data-testid="my-device-name"
          onClick={() => setChangingName(true)}
        >{devicePlayerName}</span>
      </PlayerAvatar>
    );
  }

  return (
    <PlayerAvatar playerId={playerId} connectionStatus={props.connectionStatus} turnTimer={props.turnTimer} data-testid="my-player-avatar">
      <input className="name-input"
             type="text"
             placeholder={t('namePlaceholder')}
             value={nameInputValue}
             onChange={handleInputChange}
             onKeyUp={handleInputKeyUp}
             onFocus={(e) => e.target.setSelectionRange(0, e.target.value.length)}
             autoFocus={true}
             data-testid="my-name-input"
      />
    </PlayerAvatar>
  );
}

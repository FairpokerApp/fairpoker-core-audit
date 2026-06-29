import Avatar from "./Avatar";
import React, {useEffect, useRef, useState} from "react";
import DataTestIdAttributes from "../lib/types";
import {GameAudioControls} from "../lib/useGameAudio";

const AVATAR_PALETTES = [
  {bg1: '#0f766e', bg2: '#2dd4bf', bg3: '#022c22', accent: '#f8fafc', hair: '#0f172a', shirt: '#f59e0b'},
  {bg1: '#4338ca', bg2: '#c084fc', bg3: '#1e1b4b', accent: '#fef3c7', hair: '#111827', shirt: '#22c55e'},
  {bg1: '#be123c', bg2: '#fb7185', bg3: '#4c0519', accent: '#eef2ff', hair: '#3f1d38', shirt: '#38bdf8'},
  {bg1: '#0369a1', bg2: '#38bdf8', bg3: '#082f49', accent: '#ecfeff', hair: '#1e293b', shirt: '#f97316'},
  {bg1: '#7c2d12', bg2: '#fb923c', bg3: '#431407', accent: '#fff7ed', hair: '#292524', shirt: '#06b6d4'},
  {bg1: '#166534', bg2: '#bef264', bg3: '#052e16', accent: '#f7fee7', hair: '#14532d', shirt: '#6366f1'},
  {bg1: '#6d28d9', bg2: '#f472b6', bg3: '#2e1065', accent: '#fff1f2', hair: '#27272a', shirt: '#10b981'},
  {bg1: '#0f172a', bg2: '#94a3b8', bg3: '#020617', accent: '#e0f2fe', hair: '#111827', shirt: '#ef4444'},
];

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function generateAvatarForSrcAttribute(playerId: string) {
  const hash = hashString(playerId);
  const palette = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
  const hairStyle = (hash >> 2) % 8;
  const accessoryStyle = (hash >> 6) % 7;
  const backgroundStyle = (hash >> 10) % 5;
  const expressionStyle = (hash >> 14) % 5;
  const faceTone = ['#f6c99b', '#e9b98b', '#c88d62', '#8f5f45', '#f2d2b6', '#b77955'][hash % 6];
  const blush = ['#fca5a5', '#fb7185', '#fda4af', '#fecaca', '#fdba74'][hash % 5];
  const eyeY = 63 + ((hash >> 4) % 3);
  const hair = [
    `<path d="M30 45c1-17 13-28 34-28s34 11 35 29c-8-8-15-10-25-8-8 2-19 1-28-4-6 3-11 7-16 11z" fill="${palette.hair}"/>`,
    `<path d="M27 49c2-22 18-34 38-32 19 2 31 15 32 35-12-8-22-8-33-4-12 4-23 1-37 1z" fill="${palette.hair}"/>`,
    `<path d="M29 45c5-19 18-29 36-29 17 0 28 8 34 25-13-5-25-4-38-10-8 7-18 10-32 14z" fill="${palette.hair}"/>`,
    `<path d="M32 47c-2-15 9-29 27-32 19-3 35 6 39 24-8-2-16-1-24 2-16 6-29 5-42 6z" fill="${palette.hair}"/>`,
    `<path d="M27 50c3-25 18-38 37-38s34 12 37 36c-10-3-19-4-28-1-11 4-22 4-34-1-4 1-8 2-12 4z" fill="${palette.hair}"/><path d="M40 35c10 8 24 10 42 7" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round" opacity=".45"/>`,
    `<path d="M24 57c0-25 16-43 40-43s40 18 40 43c-13-11-27-14-40-14s-27 3-40 14z" fill="${palette.hair}"/><circle cx="34" cy="51" r="10" fill="${palette.hair}"/><circle cx="94" cy="51" r="10" fill="${palette.hair}"/>`,
    `<path d="M34 42c3-18 15-28 31-28 17 0 28 10 30 27-18-10-39-10-61 1z" fill="${palette.hair}"/><path d="M45 23c12 11 23 15 38 15" fill="none" stroke="${palette.bg2}" stroke-width="6" stroke-linecap="round"/>`,
    `<path d="M29 45c4-20 17-31 35-31 15 0 27 7 34 22-17-3-30 1-43 10-8 5-16 5-26-1z" fill="${palette.hair}"/><path d="M74 18c9 3 16 9 20 18" fill="none" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round"/>`,
  ][hairStyle];
  const accessory = [
    '',
    `<g fill="none" stroke="#172033" stroke-width="4" stroke-linecap="round"><circle cx="51" cy="${eyeY}" r="9"/><circle cx="77" cy="${eyeY}" r="9"/><path d="M60 ${eyeY}h8"/></g>`,
    `<path d="M40 ${eyeY - 6}h48c2 0 4 2 3 5l-4 9c-1 3-4 5-8 5H49c-4 0-7-2-8-5l-4-9c-1-3 1-5 3-5z" fill="#111827" opacity=".9"/><path d="M48 ${eyeY - 3}h32" stroke="#fff" stroke-width="2" opacity=".24"/>`,
    `<path d="M32 45c7-20 20-30 39-30 13 0 24 5 33 15l-8 14c-17-7-36-7-64 1z" fill="${palette.accent}"/><path d="M34 45c19-7 39-7 60 0" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" opacity=".28"/>`,
    `<path d="M30 54c6-12 17-20 34-20 17 0 28 8 34 20-21-6-45-6-68 0z" fill="${palette.shirt}"/><path d="M52 29h24l7 13H45z" fill="${palette.shirt}"/>`,
    `<path d="M52 80c5 5 19 5 24 0 0 13-24 13-24 0z" fill="${palette.hair}" opacity=".82"/>`,
    `<path d="M36 70c8-8 48-8 56 0v8c-14 9-42 9-56 0z" fill="#f8fafc" opacity=".9"/><path d="M42 72c12 5 32 5 44 0" fill="none" stroke="#cbd5e1" stroke-width="3"/>`,
  ][accessoryStyle];
  const backgroundPattern = [
    `<circle cx="24" cy="27" r="18" fill="#fff" opacity=".18"/><circle cx="105" cy="98" r="24" fill="#000" opacity=".12"/>`,
    `<path d="M-8 100L100-8M20 136L136 20" stroke="#fff" stroke-width="10" opacity=".14"/>`,
    `<path d="M0 38h128M0 88h128" stroke="#fff" stroke-width="8" opacity=".12"/><path d="M40 0v128M88 0v128" stroke="#000" stroke-width="8" opacity=".08"/>`,
    `<circle cx="30" cy="34" r="6" fill="#fff" opacity=".22"/><circle cx="98" cy="28" r="10" fill="#fff" opacity=".16"/><circle cx="106" cy="96" r="7" fill="#fff" opacity=".22"/><circle cx="23" cy="91" r="11" fill="#000" opacity=".1"/>`,
    `<path d="M64-18l17 43 46 4-35 30 11 45-39-24-39 24 11-45-35-30 46-4z" fill="#fff" opacity=".14"/>`,
  ][backgroundStyle];
  const mouth = [
    `<path d="M58 79c4 4 9 4 13 0" fill="none" stroke="#172033" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M56 78c5 8 14 8 19 0" fill="none" stroke="#172033" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M58 81h13" stroke="#172033" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="64" cy="81" r="4" fill="#172033" opacity=".9"/>`,
    `<path d="M55 78c5 3 13 4 20 0" fill="none" stroke="#172033" stroke-width="4" stroke-linecap="round"/><path d="M58 84c4 2 8 2 12 0" fill="none" stroke="#172033" stroke-width="2" stroke-linecap="round" opacity=".45"/>`,
  ][expressionStyle];
  const eyebrows = [
    `<path d="M42 55c5-4 11-5 17-3M69 52c7-2 13-1 18 3" fill="none" stroke="${palette.hair}" stroke-width="4" stroke-linecap="round" opacity=".48"/>`,
    `<path d="M42 52c7 0 12 1 17 5M69 57c5-4 11-5 18-5" fill="none" stroke="${palette.hair}" stroke-width="4" stroke-linecap="round" opacity=".48"/>`,
  ][hash % 2];
  const collar = `<path d="M45 99l19 16 19-16-19 7z" fill="${palette.accent}" opacity=".95"/>`;
  const svgCode = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="bg" x1="18" y1="10" x2="112" y2="118" gradientUnits="userSpaceOnUse">
          <stop stop-color="${palette.bg2}"/>
          <stop offset=".55" stop-color="${palette.bg1}"/>
          <stop offset="1" stop-color="${palette.bg3}"/>
        </linearGradient>
        <radialGradient id="glow" cx="38%" cy="25%" r="70%">
          <stop stop-color="#fff" stop-opacity=".5"/>
          <stop offset=".58" stop-color="#fff" stop-opacity=".05"/>
          <stop offset="1" stop-color="#000" stop-opacity=".18"/>
        </radialGradient>
        <clipPath id="clip"><circle cx="64" cy="64" r="60"/></clipPath>
      </defs>
      <circle cx="64" cy="64" r="62" fill="#f8fafc"/>
      <g clip-path="url(#clip)">
        <rect width="128" height="128" fill="url(#bg)"/>
        ${backgroundPattern}
        <rect width="128" height="128" fill="url(#glow)"/>
        <path d="M15 112c12-24 30-36 49-36s37 12 49 36v22H15z" fill="${palette.shirt}"/>
        ${collar}
        <ellipse cx="64" cy="64" rx="${30 + (hash % 3)}" ry="${33 + ((hash >> 8) % 4)}" fill="${faceTone}"/>
        ${hair}
        ${eyebrows}
        <circle cx="52" cy="${eyeY}" r="${accessoryStyle === 2 ? 2 : 3}" fill="#172033"/>
        <circle cx="76" cy="${eyeY}" r="${accessoryStyle === 2 ? 2 : 3}" fill="#172033"/>
        ${accessory}
        <circle cx="45" cy="75" r="5" fill="${blush}" opacity=".38"/>
        <circle cx="83" cy="75" r="5" fill="${blush}" opacity=".38"/>
        ${mouth}
        <path d="M30 121c12-11 23-16 34-16s22 5 34 16" fill="#0f172a" opacity=".16"/>
      </g>
      <circle cx="64" cy="64" r="59" fill="none" stroke="rgba(255,255,255,.82)" stroke-width="5"/>
      <circle cx="64" cy="64" r="62" fill="none" stroke="rgba(15,23,42,.2)" stroke-width="2"/>
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgCode)}`;
}

export default function PlayerAvatar(props: DataTestIdAttributes & {
  playerId: string;
  highlight?: boolean;
  title?: string;
  connectionStatus?: 'good' | 'warn' | 'offline';
  turnTimer?: {
    active: boolean;
    timeoutSeconds?: number;
    timerKey: string;
    audio?: Pick<GameAudioControls, 'play'>;
  };
} & ({
  playerName: string;
} | {
  children: React.ReactNode;
} | {})) {
  const src = generateAvatarForSrcAttribute(props.playerId);
  const heartbeat = props.connectionStatus
    ? <span className={`avatar-heartbeat avatar-heartbeat-${props.connectionStatus}`} aria-hidden="true" />
    : null;
  const turnTimer = props.turnTimer?.active
    ? <TurnTimerBadge {...props.turnTimer} />
    : null;
  if ('playerName' in props) {
    return <div className="player-avatar" title={props.title ?? props.playerName} data-testid={props['data-testid']}>
      <Avatar highlight={props.highlight} src={src}/>
      {heartbeat}
      {turnTimer}
      <div className="avatar-label">{props.playerName}</div>
    </div>;
  }
  if ('children' in props) {
    return <div className="player-avatar" title={props.title} data-testid={props['data-testid']}>
      <Avatar highlight={props.highlight} src={src}/>
      {heartbeat}
      {turnTimer}
      <div className="avatar-label">{props.children}</div>
    </div>;
  }
  return <div className="player-avatar" title={props.title} data-testid={props['data-testid']}>
    <Avatar
      highlight={props.highlight}
      src={src}
    />
    {heartbeat}
    {turnTimer}
  </div>;
}

function TurnTimerBadge(props: {
  active: boolean;
  timeoutSeconds?: number;
  timerKey: string;
  audio?: Pick<GameAudioControls, 'play'>;
}) {
  const timeoutSeconds = props.timeoutSeconds;
  const warningSeconds = timeoutSeconds ? Math.min(10, timeoutSeconds) : 0;
  const deadlineRef = useRef(Date.now() + (timeoutSeconds ?? 0) * 1000);
  const lastBeepSecondRef = useRef<number | null>(null);
  const playRef = useRef(props.audio?.play);
  const [remainingSeconds, setRemainingSeconds] = useState(timeoutSeconds ?? 0);

  useEffect(() => {
    playRef.current = props.audio?.play;
  }, [props.audio]);

  useEffect(() => {
    if (!props.active || !timeoutSeconds) {
      setRemainingSeconds(0);
      return;
    }
    deadlineRef.current = Date.now() + timeoutSeconds * 1000;
    lastBeepSecondRef.current = null;

    const update = () => {
      const nextRemaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setRemainingSeconds(nextRemaining);
      if (nextRemaining > 0 && nextRemaining <= warningSeconds && lastBeepSecondRef.current !== nextRemaining) {
        lastBeepSecondRef.current = nextRemaining;
        playRef.current?.('countdown');
      }
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [props.active, props.timerKey, timeoutSeconds, warningSeconds]);

  if (!props.active || !timeoutSeconds || remainingSeconds <= 0) {
    return null;
  }

  const progress = Math.max(0, Math.min(1, remainingSeconds / timeoutSeconds));
  const tone = remainingSeconds <= 5 ? 'danger' : remainingSeconds <= 10 ? 'warn' : 'good';
  return (
    <span
      className={`turn-timer-badge turn-timer-badge-${tone}`}
      data-testid="turn-timer-badge"
      style={{'--turn-progress': `${progress * 100}%`} as React.CSSProperties}
      aria-label={`${remainingSeconds}s`}
    >
      {remainingSeconds}
    </span>
  );
}

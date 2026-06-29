import {useEffect, useMemo, useState} from "react";
import {TexasHoldem} from "./setup";
import {GameRoomStatus} from "./GameRoom";
import {TranscriptEntry, TranscriptSnapshot, verifyTranscript} from "./fairness/transcript";
import {SIGNED_EVENT_KIND, SignedGameEvent} from "./fairness/eventSigning";
import {getRuntimeCodeSource} from "./runtimeCodeSource";
import {verifyRunningClientCid} from "./clientCidVerification";
import {getCachedRuntimeReleaseIdentity, loadRuntimeReleaseIdentity} from "./runtimeReleaseIdentity";
import {getSignalingUrl} from "./signalingConfig";

type RelayHealth = 'checking' | 'online' | 'offline' | 'not-configured';

type SecurityPhase =
  | 'waiting'
  | 'shuffle'
  | 'lock'
  | 'finalizing'
  | 'ready'
  | 'sealed';

type TranscriptPayload = {
  type?: string;
  round?: number;
  [key: string]: unknown;
};

function getPayload(entry: TranscriptEntry<unknown>): TranscriptPayload | null {
  const wireEvent = entry.wireEvent as TranscriptPayload | SignedGameEvent<TranscriptPayload>;
  if (!wireEvent || typeof wireEvent !== 'object') {
    return null;
  }
  if ((wireEvent as SignedGameEvent<TranscriptPayload>).kind === SIGNED_EVENT_KIND) {
    return (wireEvent as SignedGameEvent<TranscriptPayload>).payload;
  }
  return wireEvent as TranscriptPayload;
}

function createHealthUrl(signalUrl: string | undefined): string | undefined {
  if (!signalUrl) {
    return undefined;
  }
  try {
    const url = new URL(signalUrl);
    url.protocol = url.protocol === 'http:' ? 'http:' : 'https:';
    url.pathname = '/health';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function shortHash(value: string | undefined) {
  if (!value) {
    return 'no-events-yet';
  }
  return value.length > 24 ? `${value.slice(0, 15)}...${value.slice(-8)}` : value;
}

export function downloadTranscriptSnapshot(snapshot: TranscriptSnapshot<unknown> | null) {
  if (!snapshot || snapshot.entries.length === 0) {
    return;
  }

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fairpoker-transcript-${snapshot.finalHash.replace(/[^a-z0-9]/gi, '-').slice(0, 28)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useSecurityStatus(props: {
  peerState: GameRoomStatus;
  members: string[];
  players: string[] | undefined;
  round: number | undefined;
  currentRoundFinished: boolean;
}) {
  const {peerState, members, players, round, currentRoundFinished} = props;
  const [relayHealth, setRelayHealth] = useState<RelayHealth>('checking');
  const [transcript, setTranscript] = useState<TranscriptSnapshot<unknown> | null>(
    () => TexasHoldem?.getTranscript?.() ?? null,
  );
  const [verification, setVerification] = useState<'idle' | 'passed' | 'failed'>('idle');
  // Canonical Game client CID, so the UI can show whether the running bundle is
  // the pinned, content-addressed one. (Audit B12.)
  const [releaseGameClientCid, setReleaseGameClientCid] = useState(getCachedRuntimeReleaseIdentity().gameClientCid);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    void loadRuntimeReleaseIdentity()
      .then(identity => setReleaseGameClientCid(identity.gameClientCid))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      setRelayHealth('online');
      return;
    }

    const healthUrl = createHealthUrl(getSignalingUrl());
    if (!healthUrl) {
      setRelayHealth('not-configured');
      return;
    }

    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch(healthUrl, {cache: 'no-store'});
        if (!stopped) {
          setRelayHealth(response.ok ? 'online' : 'offline');
        }
      } catch {
        if (!stopped) {
          setRelayHealth('offline');
        }
      }
    };

    void check();
    const timer = window.setInterval(check, 15000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const listener = () => {
      setTranscript(TexasHoldem?.getTranscript?.() ?? null);
      setVerification('idle');
    };
    if (!TexasHoldem?.listener) {
      listener();
      return;
    }
    TexasHoldem.listener.on('transcript', listener);
    listener();
    return () => {
      TexasHoldem.listener.off('transcript', listener);
    };
  }, []);

  const stats = useMemo(() => {
    const entries = transcript?.entries ?? [];
    const roundEntries = round
      ? entries.filter(entry => getPayload(entry)?.round === round)
      : [];
    const count = (type: string) => roundEntries.filter(entry => getPayload(entry)?.type === type).length;
    const decryptCount = roundEntries.filter(entry => getPayload(entry)?.type === 'card/decrypt').length;

    return {
      entriesCount: entries.length,
      finalHash: transcript?.finalHash,
      shortHash: shortHash(transcript?.finalHash),
      shuffleCount: count('deck/shuffle'),
      lockCount: count('deck/lock'),
      finalizedCount: count('deck/finalized'),
      decryptCount,
    };
  }, [round, transcript]);

  const participantsCount = Math.max(players?.length ?? members.length, 0);
  const phase: SecurityPhase = useMemo(() => {
    if (!round) {
      return 'waiting';
    }
    if (stats.finalizedCount === 0) {
      if (stats.shuffleCount < Math.max(participantsCount, 1)) {
        return 'shuffle';
      }
      if (stats.lockCount < Math.max(participantsCount, 1)) {
        return 'lock';
      }
      return 'finalizing';
    }
    return currentRoundFinished ? 'sealed' : 'ready';
  }, [currentRoundFinished, participantsCount, round, stats.finalizedCount, stats.lockCount, stats.shuffleCount]);

  const verifyLocally = async () => {
    if (!transcript || transcript.entries.length === 0) {
      setVerification('failed');
      return;
    }
    const result = await verifyTranscript(transcript);
    setVerification(result.ok ? 'passed' : 'failed');
  };

  const codeSource = getRuntimeCodeSource();
  return {
    codeSource,
    clientCidVerification: verifyRunningClientCid(codeSource, releaseGameClientCid),
    connected: peerState !== 'NotReady' && peerState !== 'Closed',
    peerState,
    relayHealth,
    opponentCount: Math.max(members.length - 1, 0),
    participantsCount,
    transcript,
    stats,
    phase,
    verification,
    verifyLocally,
    downloadTranscript: () => downloadTranscriptSnapshot(transcript),
  };
}

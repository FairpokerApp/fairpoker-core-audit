import {useCallback, useEffect, useRef, useState} from "react";

type ToneName = 'enable' | 'shuffle' | 'ready' | 'turn' | 'card' | 'win' | 'countdown';
type SpokenAction = 'check' | 'call' | 'raise' | 'fold' | 'all in' | 'bet';
type SpokenAsset = SpokenAction | 'sound on';

const TONES: Record<ToneName, {frequency: number; duration: number; gain: number}> = {
  enable: {frequency: 660, duration: 0.09, gain: 0.09},
  shuffle: {frequency: 330, duration: 0.07, gain: 0.065},
  ready: {frequency: 780, duration: 0.13, gain: 0.085},
  turn: {frequency: 520, duration: 0.11, gain: 0.085},
  card: {frequency: 430, duration: 0.06, gain: 0.065},
  win: {frequency: 880, duration: 0.16, gain: 0.09},
  countdown: {frequency: 980, duration: 0.08, gain: 0.075},
};

const SPOKEN_AUDIO_FILES: Record<SpokenAsset, string> = {
  'sound on': 'sound-on.wav',
  check: 'check.wav',
  call: 'call.wav',
  raise: 'raise.wav',
  fold: 'fold.wav',
  'all in': 'all-in.wav',
  bet: 'bet.wav',
};

function isChromeLike() {
  const ua = navigator.userAgent;
  return /Chrome\/|CriOS\/|Edg\//.test(ua) && !/Version\/[\d.]+ Safari\//.test(ua);
}

function createAudioContext(): AudioContext | null {
  const AudioContextCtor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
}

function chooseEnglishVoice(voices: SpeechSynthesisVoice[]) {
  const englishVoices = voices.filter(voice => /^en([-_]|$)/i.test(voice.lang));
  if (englishVoices.length === 0) {
    return null;
  }

  const preferredNames = [
    'Samantha',
    'Alex',
    'Daniel',
    'Karen',
    'Google US English',
    'Microsoft Jenny',
    'Microsoft Aria',
  ];

  return [...englishVoices].sort((a, b) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const nameScore = preferredNames.findIndex(name => voice.name.includes(name));
      return (
        (voice.localService ? 80 : 0)
        + (/en-US/i.test(voice.lang) ? 30 : 0)
        + (nameScore >= 0 ? 100 - nameScore : 0)
      );
    };
    return score(b) - score(a);
  })[0];
}

function speakNow(phrase: SpokenAction | 'sound on', voice?: SpeechSynthesisVoice | null) {
  const synth = window.speechSynthesis;
  if (!synth) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.lang = 'en-US';
  utterance.voice = voice ?? chooseEnglishVoice(synth.getVoices()) ?? null;
  utterance.rate = isChromeLike() ? 0.86 : 0.94;
  utterance.pitch = isChromeLike() ? 1.02 : 0.96;
  utterance.volume = isChromeLike() ? 0.78 : 0.9;

  const play = () => synth.speak(utterance);
  if (synth.speaking || synth.pending) {
    synth.cancel();
    window.setTimeout(play, isChromeLike() ? 42 : 16);
    return;
  }
  play();
}

function spokenAudioUrl(phrase: SpokenAsset) {
  return `${process.env.PUBLIC_URL}/audio/actions/${SPOKEN_AUDIO_FILES[phrase]}`;
}

export function useGameAudio() {
  const [enabled, setEnabled] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const spokenAudioRef = useRef<Map<SpokenAsset, HTMLAudioElement> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const primeSpeechVoice = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    const update = () => {
      voiceRef.current = chooseEnglishVoice(synth.getVoices());
    };
    update();
    synth.onvoiceschanged = update;
  }, []);

  const ensureSpokenAudio = useCallback(() => {
    if (spokenAudioRef.current) {
      return spokenAudioRef.current;
    }
    const audioMap = new Map<SpokenAsset, HTMLAudioElement>();
    (Object.keys(SPOKEN_AUDIO_FILES) as SpokenAsset[]).forEach(phrase => {
      const audio = new Audio(spokenAudioUrl(phrase));
      audio.preload = 'auto';
      audio.volume = 0.86;
      audioMap.set(phrase, audio);
    });
    spokenAudioRef.current = audioMap;
    return audioMap;
  }, []);

  const playSpokenAudio = useCallback((phrase: SpokenAsset) => {
    const audio = ensureSpokenAudio().get(phrase);
    if (!audio) {
      return false;
    }
    audio.pause();
    audio.currentTime = 0;
    const result = audio.play();
    if (result) {
      result.catch(() => speakNow(phrase, voiceRef.current));
    }
    return true;
  }, [ensureSpokenAudio]);

  const playTone = useCallback((toneName: ToneName) => {
    const context = contextRef.current;
    if (!context) {
      return;
    }
    const tone = TONES[toneName];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(tone.frequency, now);
    oscillator.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(tone.gain, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);
    oscillator.start(now);
    oscillator.stop(now + tone.duration + 0.02);
  }, []);

  const play = useCallback((toneName: ToneName) => {
    if (!enabled) {
      return;
    }
    playTone(toneName);
  }, [enabled, playTone]);

  const speak = useCallback((phrase: SpokenAction) => {
    if (!enabled) {
      return;
    }
    if (!playSpokenAudio(phrase)) {
      speakNow(phrase, voiceRef.current);
    }
  }, [enabled, playSpokenAudio]);

  const toggle = useCallback(async () => {
    if (!contextRef.current) {
      contextRef.current = createAudioContext();
    }
    ensureSpokenAudio();
    primeSpeechVoice();
    if (contextRef.current?.state === 'suspended') {
      await contextRef.current.resume();
    }
    const next = !enabled;
    setEnabled(next);
    if (next) {
      playTone('enable');
      if (!playSpokenAudio('sound on')) {
        speakNow('sound on', voiceRef.current);
      }
    }
  }, [enabled, ensureSpokenAudio, playSpokenAudio, playTone, primeSpeechVoice]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    spokenAudioRef.current?.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    void contextRef.current?.close();
  }, []);

  return {
    enabled,
    toggle,
    play,
    speak,
  };
}

export type GameAudioControls = ReturnType<typeof useGameAudio>;

import React, {FormEvent, useEffect, useMemo, useState} from "react";
import {
  AUTH_SESSION_CHANGED_EVENT,
  AuthSession,
  clearAuthSession,
  enterAccount,
  getActiveAuthSession,
  verifyActiveAuthSession,
} from "../lib/auth";
import {ensureSetupReady} from "../lib/setup";
import {LanguageSelect, useI18n} from "../lib/i18n";
import {AuditProgram, auditStatus} from "../generated/auditStatus";
import {loadRuntimeReleaseIdentity} from "../lib/runtimeReleaseIdentity";
import {detectInAppBrowser} from "../lib/inAppBrowser";
import InAppBrowserGuide from "./InAppBrowserGuide";
import fairPokerMark from "../assets/fairpoker-mark.svg";

type GatewayHealthStatus = 'checking' | 'good' | 'slow' | 'bad';
type GatewayHealth = {
  status: GatewayHealthStatus;
  latencyMs?: number;
};
type IpfsLink = {
  label: string;
  href: string;
  kind: string;
  host: string;
};
type RuntimeReleaseIdentity = {
  gameClientCid: string;
  sourceIpfsCid: string;
  sourceArchiveFile: string;
};

const GATEWAY_HEAD_TIMEOUT_MS = 6500;
const GATEWAY_GET_TIMEOUT_MS = 8500;
const GATEWAY_SLOW_THRESHOLD_MS = 2500;
const OFFICIAL_HOSTS = new Set(['fairpoker.app', 'www.fairpoker.app']);
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function cleanCid(value: string | undefined) {
  if (!value || value.startsWith('not-provided')) {
    return '';
  }
  return value;
}

function sourceArchiveFileName(value: string) {
  return /^fair-poker-source-[a-f0-9]{12}\.tar\.gz$/.test(value) ? value : '';
}

function buildIpfsLinks(cid: string, directory: boolean, downloadFileName = ''): IpfsLink[] {
  if (!cid) {
    return [];
  }
  const suffix = directory ? '/' : '';
  const downloadQuery = !directory && downloadFileName
    ? `?download=true&filename=${encodeURIComponent(downloadFileName)}`
    : '';
  const shortCid = cid.length > 16 ? `${cid.slice(0, 8)}...${cid.slice(-6)}` : cid;
  return [
    {label: `ipfs.io/ipfs/${shortCid}${suffix}`, href: `https://ipfs.io/ipfs/${cid}${suffix}${downloadQuery}`, kind: 'gateway', host: 'ipfs.io'},
    {label: `${shortCid}.ipfs.dweb.link${suffix}`, href: `https://${cid}.ipfs.dweb.link${suffix}${downloadQuery}`, kind: 'gateway', host: 'dweb.link'},
    {label: `${shortCid}.ipfs.w3s.link${suffix}`, href: `https://${cid}.ipfs.w3s.link${suffix}${downloadQuery}`, kind: 'gateway', host: 'w3s.link'},
  ];
}

function buildHealthProbeUrl(href: string) {
  const url = new URL(href);
  url.searchParams.set('fp_health', String(Date.now()));
  return url.toString();
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      controller.abort();
      reject(new Error('Gateway probe timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(url, {...options, signal: controller.signal}),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
}

async function probeGateway(href: string): Promise<GatewayHealth> {
  if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') {
    return {status: 'checking'};
  }
  const startedAt = performance.now();
  try {
    await fetchWithTimeout(buildHealthProbeUrl(href), {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-store',
      redirect: 'follow',
    }, GATEWAY_HEAD_TIMEOUT_MS).then(response => {
      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
    return {status: latencyMs > GATEWAY_SLOW_THRESHOLD_MS ? 'slow' : 'good', latencyMs};
  } catch {
    try {
      await fetchWithTimeout(buildHealthProbeUrl(href), {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        redirect: 'follow',
        headers: {'Range': 'bytes=0-0'},
      }, GATEWAY_GET_TIMEOUT_MS);
      const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      return {status: latencyMs > GATEWAY_SLOW_THRESHOLD_MS ? 'slow' : 'good', latencyMs};
    } catch {
      return {status: 'bad'};
    }
  }
}

function useGatewayHealth(links: IpfsLink[]) {
  const [health, setHealth] = useState<Record<string, GatewayHealth>>({});
  const key = links.map(link => link.href).join('|');

  useEffect(() => {
    if (!links.length) {
      return;
    }
    let cancelled = false;
    setHealth(Object.fromEntries(links.map(link => [link.href, {status: 'checking' as GatewayHealthStatus}])));

    links.forEach(link => {
      probeGateway(link.href).then(result => {
        if (cancelled) {
          return;
        }
        setHealth(prev => ({...prev, [link.href]: result}));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [key, links]);

  return health;
}

function useRuntimeReleaseIdentity() {
  const [identity, setIdentity] = useState<RuntimeReleaseIdentity>({
    gameClientCid: '',
    sourceIpfsCid: '',
    sourceArchiveFile: '',
  });

  useEffect(() => {
    let cancelled = false;
    loadRuntimeReleaseIdentity()
      .then(payload => {
        if (cancelled) {
          return;
        }
        setIdentity({
          gameClientCid: cleanCid(payload.gameClientCid),
          sourceIpfsCid: cleanCid(payload.sourceIpfsCid),
          sourceArchiveFile: sourceArchiveFileName(payload.sourceArchiveFile),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setIdentity({gameClientCid: '', sourceIpfsCid: '', sourceArchiveFile: ''});
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return identity;
}

function isOfficialHost() {
  return OFFICIAL_HOSTS.has(window.location.hostname);
}

function isGameEntryIntent() {
  const params = new URLSearchParams(window.location.search);
  return params.get('entry') === 'game'
    || params.has('gameRoomId')
    || params.has('tableId');
}

function isHomepageHost() {
  if (isGameEntryIntent()) {
    return false;
  }
  return isOfficialHost() || DEV_HOSTS.has(window.location.hostname);
}

function buildGameEntryUrl(cid: string) {
  const base = cid
    ? `https://ipfs.io/ipfs/${cid}/`
    : window.location.href;
  const url = new URL(base);
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key !== 'entry') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function clearEntryIntentFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('entry')) {
    return;
  }
  url.searchParams.delete('entry');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function auditProgramHref(reportUrl: string) {
  if (!reportUrl) {
    return '';
  }
  if (/^https?:\/\//.test(reportUrl)) {
    return reportUrl;
  }
  return `${process.env.PUBLIC_URL}${reportUrl}`;
}

export default function AuthGate(props: { children: React.ReactNode }) {
  const {t} = useI18n();
  const [session, setSession] = useState<AuthSession | null>(() => getActiveAuthSession());
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // RELEASE BOUNDARY: the homepage reads release identity from ai.json at
  // runtime. Homepage/Snyk/AI/marketing/audit-display changes must not create
  // or imply a new Game client CID.
  const runtimeReleaseIdentity = useRuntimeReleaseIdentity();
  const gameIpfsCid = runtimeReleaseIdentity.gameClientCid;
  const sourceIpfsCid = runtimeReleaseIdentity.sourceIpfsCid;
  const gameIpfsLinks = useMemo(() => buildIpfsLinks(gameIpfsCid, true), [gameIpfsCid]);
  const sourceIpfsLinks = useMemo(
    () => buildIpfsLinks(sourceIpfsCid, false, runtimeReleaseIdentity.sourceArchiveFile),
    [sourceIpfsCid, runtimeReleaseIdentity.sourceArchiveFile]
  );
  const allIpfsLinks = useMemo(() => [...gameIpfsLinks, ...sourceIpfsLinks], [gameIpfsLinks, sourceIpfsLinks]);
  const gatewayHealth = useGatewayHealth(allIpfsLinks);
  const officialHost = isOfficialHost();
  const homepageHost = isHomepageHost();
  const invitedTableId = useMemo(
    () => {
      const params = new URLSearchParams(window.location.search);
      return params.get('tableId') || params.get('gameRoomId') || '';
    },
    []
  );
  // Restricted in-app browsers (Telegram/WeChat/etc.) can't run the IPFS
  // verification layer, so instead of dropping into an unverifiable mode we
  // guide the user to reopen the page in a real system browser.
  const inApp = useMemo(() => detectInAppBrowser(), []);
  const [showInAppGuide, setShowInAppGuide] = useState(false);
  const inAppGuideUrl = useMemo(() => window.location.href, []);
  const comparisonRows = [
    ['comparisonRow1Type', 'comparisonRow1Strength', 'comparisonRow1Verify', 'comparisonRow1FairPoker'],
    ['comparisonRow2Type', 'comparisonRow2Strength', 'comparisonRow2Verify', 'comparisonRow2FairPoker'],
    ['comparisonRow3Type', 'comparisonRow3Strength', 'comparisonRow3Verify', 'comparisonRow3FairPoker'],
    ['comparisonRow4Type', 'comparisonRow4Strength', 'comparisonRow4Verify', 'comparisonRow4FairPoker'],
    ['comparisonRow5Type', 'comparisonRow5Strength', 'comparisonRow5Verify', 'comparisonRow5FairPoker'],
  ] as const;
  const faqRows = [
    {
      question: 'faqQuestion1',
      answer: 'faqAnswer1',
      source: 'fair-poker-source/src/lib/runtimeReleaseIdentity.ts:27-49; fair-poker-source/scripts/generate-release-metadata.js:85-145',
      code: `const response = await fetch(url.toString(), { cache: 'no-store' });
cachedIdentity = {
  gameClientCid: payload?.canonicalReleaseIdentity?.gameClientCid || '',
  sourceIpfsCid: payload?.currentSourceRelease?.ipfsCid || '',
  sourceFingerprint: payload?.currentSourceRelease?.sourceFingerprint || '',
  archiveSha256: payload?.currentSourceRelease?.archiveSha256 || '',
};

const sourceFingerprint = \`sha256:\${hash.digest('hex')}\`;
const metadata = { verifierVersion: 'hash-chain-signature-result-replay-v0', sourceFingerprint };`,
    },
    {
      question: 'faqQuestion2',
      answer: 'faqAnswer2',
      source: 'fair-poker-source/src/lib/MentalPokerGameRoom.ts:219-237, 240-250, 340-381',
      code: `this.gameRoom.listener.on('event', ({ data }, _who, replay) => {
  switch (data.type) {
    case 'start': this.handleRoundStartEvent(data, !!replay); break;
    case 'deck/shuffle': this.handleDeckShuffleEvent(data, !!replay); break;
    case 'deck/lock': this.handleDeckLockEvent(data, !!replay); break;
    case 'card/decrypt': this.handleCardDecrypted(data); break;
  }
});

await this.firePublicEvent({ type: 'start', round: newRound, mentalPokerSettings: settings });
await this.firePrivateEvent({ type: 'card/decrypt', round, cardOffset, player, decryptionKey }, recipient);`,
    },
    {
      question: 'faqQuestion3',
      answer: 'faqAnswer3',
      source: 'fair-poker-source/src/lib/MentalPokerGameRoom.ts:116-122, 145-180, 307-381',
      code: `const dk = player.getIndividualKey(i).decryptionKey;
keys[i] = { d: dk.d.toString(), n: dk.n.toString() };

decryptionKeys: Array<Map<string, Deferred<DecryptionKey>>> = new Array(CARDS)
  .fill({}).map(() => new Map());

const dk = await this.getDecryptionKeyForCard(roundData, cardOffset, participant);
await this.firePrivateEvent({ type: 'card/decrypt', round, cardOffset, player: participant, decryptionKey: dk }, recipient);`,
    },
    {
      question: 'faqQuestion4',
      answer: 'faqAnswer4',
      source: 'fair-poker-source/src/lib/cryptoShuffle.ts:16-52; fair-poker-source/src/lib/secureMentalPoker.ts:76-85, 115-135; fair-poker-source/scripts/verify-transcript.js:366-390',
      code: `cryptoApi.getRandomValues(sample);
return sample[0] % maxExclusive;

const encryptedDeck = deck.encrypt(mainSraKey);
return secureShuffleEncodedDeck(encryptedDeck);

if (payload.shuffleIndex > 0 && !round.mentalPoker.shuffles.includes(payload.shuffleIndex - 1)) {
  addError(errors, entry.index, 'deck/shuffle happened before previous shuffle');
}
if (round.mentalPoker.shuffles.length === participants.length) round.mentalPoker.deckStep2 = true;`,
    },
    {
      question: 'faqQuestion5',
      answer: 'faqAnswer5',
      source: 'fair-poker-source/scripts/verify-transcript.js:521-545, 758-790; fair-poker-source/src/lib/fairness/transcript.ts:103-144',
      code: `if (owner && sender !== owner) {
  addError(errors, entry.index, \`Round \${payload.round} \${owner} decrypt key sent by wrong player\`);
}

validateMentalPoker(entry);
validateTexasHoldem(entry);

if (round.texasHoldem.newRound && !round.mentalPoker.finalized) {
  addError(errors, null, \`Round \${round.round} has table play without finalized deck\`);
}`,
    },
    {
      question: 'faqQuestion6',
      answer: 'faqAnswer6',
      source: 'fair-poker-source/scripts/verify-transcript.js:670-755, 772-798, 925-943',
      code: `case 'action/bet':
  state.pot.set(sender, (state.pot.get(sender) ?? 0) + payload.amount);
  round.texasHoldem.potTotal = Array.from(state.pot.values()).reduce((a, b) => a + b, 0);
  break;

deriveShowdownIfPossible(round, state);
const output = { ...result, gameProtocol, ok: result.ok && gameProtocol.ok };
process.exit(output.ok ? 0 : 1);`,
    },
    {
      question: 'faqQuestion7',
      answer: 'faqAnswer7',
      source: 'fair-poker-source/src/lib/fairness/eventSigning.ts:100-176; fair-poker-source/src/lib/fairness/transcript.ts:61-90, 103-144',
      code: `payloadHash: \`sha256:\${await sha256Hex(canonicalJson(payload))}\`,
const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, utf8Bytes(canonicalJson(unsigned)));

const eventHash = \`sha256:\${await sha256Hex(canonicalJson({ ...unsignedEntry, previousHash: this.latestHash }))}\`;
if (entry.previousHash !== previousHash) return { ok: false, reason: 'Previous hash mismatch' };
if (eventHash !== recomputedHash) return { ok: false, reason: 'Event hash mismatch' };`,
    },
    {
      question: 'faqQuestion8',
      answer: 'faqAnswer8',
      source: 'fair-poker-source/scripts/create-source-release.js:285-320; fair-poker-source/scripts/generate-release-metadata.js:85-145; fair-poker-source/README.md:318-337',
      code: `const hash = crypto.createHash('sha256');
for (const file of files) {
  hash.update(relative);
  hash.update('\\0');
  hash.update(hashContent(file));
}
const sourceFingerprint = \`sha256:\${hash.digest('hex')}\`;

npm ci
npm run generate:release-metadata
grep sourceFingerprint src/generated/releaseMetadata.ts`,
    },
    {
      question: 'faqQuestion9',
      answer: 'faqAnswer9',
      source: 'fair-poker-source/src/lib/runtimeReleaseIdentity.ts:27-49; fair-poker-source/scripts/create-source-release.js:285-320; fair-poker-source/scripts/generate-release-metadata.js:94-145',
      code: `const url = new URL('ai.json', window.location.href);
url.searchParams.set('release_identity', String(Date.now()));

cachedIdentity = {
  gameClientCid: payload?.canonicalReleaseIdentity?.gameClientCid || '',
  sourceIpfsCid: payload?.currentSourceRelease?.ipfsCid || '',
  sourceFingerprint: payload?.currentSourceRelease?.sourceFingerprint || '',
  archiveSha256: payload?.currentSourceRelease?.archiveSha256 || '',
};

const manifest = {
  sourceFingerprint,
  archiveSha256,
  ipfsCid,
  buildCommand: 'npm ci && npm run build',
};`,
    },
  ] as const;

  useEffect(() => {
    if (homepageHost || session || isGameEntryIntent()) {
      return;
    }
    clearEntryIntentFromUrl();
  }, [homepageHost, session]);

  useEffect(() => {
    if (!officialHost || !invitedTableId || !gameIpfsCid || inApp.isInApp) {
      return;
    }
    window.location.replace(buildGameEntryUrl(gameIpfsCid));
  }, [gameIpfsCid, invitedTableId, officialHost, inApp.isInApp]);

  useEffect(() => {
    const refreshSession = () => setSession(getActiveAuthSession());
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === 'fairpoker:authSession') {
        refreshSession();
      }
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refreshSession);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refreshSession);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!session || officialHost) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    setError('');
    verifyActiveAuthSession(session)
      .then(validSession => {
        if (!validSession) {
          clearAuthSession();
          if (!cancelled) {
            setSession(null);
            setError('登录已过期，请重新输入账号密码。');
          }
          return null;
        }
        return ensureSetupReady();
      })
      .then(setup => {
        if (setup && !cancelled) {
          setReady(true);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('tableSetupFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [officialHost, session, t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-]{3,24}$/.test(cleanUsername)) {
      setError(t('usernameInvalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('passwordMin'));
      return;
    }
    if (password.length > 128) {
      setError(t('passwordMax'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextSession = await enterAccount(username, password);
      setSession(nextSession);
      if (officialHost && gameIpfsCid) {
        window.location.assign(buildGameEntryUrl(gameIpfsCid));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accountFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!officialHost && session && ready) {
    return <>{props.children}</>;
  }

  // Restricted in-app browser trying to enter a game (invite link, the game
  // client itself, or the homepage "enter" button): show the open-in-browser
  // guide instead of forwarding into an unverifiable experience. Plain homepage
  // browsing is left untouched so visitors can still read everything in-app.
  if (inApp.isInApp && (showInAppGuide || invitedTableId || !homepageHost)) {
    return <InAppBrowserGuide info={inApp} url={inAppGuideUrl} />;
  }

  if (!officialHost && session) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card-compact">
          <div className="auth-eyebrow">{t('accountEyebrow')}</div>
          <h1>{t('enteringTitle')}</h1>
          <p>{t('enteringCopy')}</p>
          {error && <div className="auth-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (officialHost && invitedTableId) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card-compact">
          <div className="auth-eyebrow">{t('officialInviteEyebrow')}</div>
          <h1>{t('openingIpfsGameTitle')}</h1>
          <p>{t('openingIpfsGameCopy')}</p>
        </div>
      </div>
    );
  }

  if (!homepageHost) {
    return (
      <div className="auth-screen auth-game-entry-screen">
        <div className="auth-card auth-game-entry-card">
          <div className="auth-eyebrow">{t('ipfsClientEyebrow')}</div>
          <h1>{t('ipfsGameEntryTitle')}</h1>
          <p>{t('ipfsGameEntryCopy')}</p>
          <AccountEntryForm
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            busy={busy}
            error={error}
            submit={submit}
            compact
          />
          <a
            className="auth-home-link"
            href="https://fairpoker.app/"
          >
            {t('returnOfficialHome')}
          </a>
        </div>
      </div>
    );
  }

  const enterIpfsGame = () => {
    if (inApp.isInApp) {
      setShowInAppGuide(true);
      return;
    }
    window.location.assign(buildGameEntryUrl(gameIpfsCid));
  };

  return (
    <div className="auth-screen">
      <header className="auth-topbar" aria-label={t('heroTitle')}>
        <div className="auth-logo">
          <img className="auth-logo-mark" src={fairPokerMark} alt="" aria-hidden="true" />
          <div>
            <strong>Fair Poker</strong>
            <small>{t('brandSubtitle')}</small>
          </div>
        </div>
        <nav className="auth-topbar-nav" aria-label="Sections">
          <a href={`${process.env.PUBLIC_URL}/audit-report.html`}>{t('navEvidence')}</a>
          <a href={`${process.env.PUBLIC_URL}/verify-guide.html`}>{t('navVerify')}</a>
          <a href={`${process.env.PUBLIC_URL}/security.html`}>{t('navSecurity')}</a>
        </nav>
        <LanguageSelect className="auth-language-select" />
      </header>

      <main className="auth-landing">
        <section className="auth-hero" aria-label={t('heroAria')}>
          <div className="auth-hero-copy">
            <span className="auth-hero-kick">{t('heroKick')}</span>
            <h1 className="auth-hero-headline">{t('heroHeadline')}</h1>
            <p className="auth-hero-sub">{t('heroSubhead')}</p>
            <p className="auth-hero-sub auth-hero-sub-ipfs">{t('heroSubhead2')}</p>
            <div className="auth-hero-cta">
              <button
                className="auth-primary"
                type="button"
                onClick={() => enterIpfsGame()}
              >
                {t('enterGame')}
              </button>
              <a className="auth-ghost" href="#auth-why">{t('heroSecondary')} &#8594;</a>
            </div>
            <div className="auth-hero-chips" aria-label={t('platformTrustStatus')}>
              <span>{t('chipNoServer')}</span>
              <span>{t('chipE2e')}</span>
              <span>{t('chipAutoCheck')}</span>
              <span>{t('chipVerify')}</span>
            </div>
          </div>

          <div className="auth-stage" aria-hidden="true">
            <div className="auth-stage-orbit auth-stage-orbit-one" />
            <div className="auth-stage-orbit auth-stage-orbit-two" />
            <div className="auth-table-felt">
              <div className="auth-card-row">
                <img src={`${process.env.PUBLIC_URL}/cards/sa.svg`} alt="" />
                <img src={`${process.env.PUBLIC_URL}/cards/hk.svg`} alt="" />
                <img src={`${process.env.PUBLIC_URL}/cards/back.svg`} alt="" />
                <img src={`${process.env.PUBLIC_URL}/cards/dq.svg`} alt="" />
              </div>
              <div className="auth-chip-stack">
                <img src={`${process.env.PUBLIC_URL}/chip.svg`} alt="" />
                <span>{t('transcriptHashLabel')}</span>
              </div>
            </div>
          </div>

        </section>

        <section className="auth-steps" aria-label={t('stepsTitle')}>
          <div className="auth-section-head">
            <span className="auth-eyebrow">{t('stepsKicker')}</span>
            <h2>{t('stepsTitle')}</h2>
          </div>
          <div className="auth-steps-grid">
            <article>
              <span className="auth-step-num">1</span>
              <strong>{t('step1Title')}</strong>
              <p>{t('step1Text')}</p>
            </article>
            <article>
              <span className="auth-step-num">2</span>
              <strong>{t('step2Title')}</strong>
              <p>{t('step2Text')}</p>
            </article>
            <article>
              <span className="auth-step-num">3</span>
              <strong>{t('step3Title')}</strong>
              <p>{t('step3Text')}</p>
            </article>
          </div>
        </section>

        <section className="auth-why" id="auth-why" aria-label={t('whyTitle')}>
          <div className="auth-section-head">
            <span className="auth-eyebrow">{t('whyKicker')}</span>
            <h2>{t('whyTitle')}</h2>
          </div>
          <div className="auth-why-grid">
            <article>
              <strong>{t('assurance1Title')}</strong>
              <p>{t('assurance1Text')}</p>
            </article>
            <article>
              <strong>{t('assurance2Title')}</strong>
              <p>{t('assurance2Text')}</p>
            </article>
            <article>
              <strong>{t('assurance3Title')}</strong>
              <p>{t('assurance3Text')}</p>
            </article>
            <article>
              <strong>{t('assurance4Title')}</strong>
              <p>{t('assurance4Text')}</p>
            </article>
          </div>
        </section>

        <section className="auth-verify" aria-label={t('verifyTitle')}>
          <div className="auth-section-head">
            <span className="auth-eyebrow auth-eyebrow-gold">{t('verifyKicker')}</span>
            <h2>{t('verifyTitle')}</h2>
          </div>
          <ol className="auth-verify-steps">
            <li><span className="auth-verify-num">&#9312;</span><span>{t('verifyStep1')}</span></li>
            <li><span className="auth-verify-num">&#9313;</span><span>{t('verifyStep2')}</span></li>
            <li><span className="auth-verify-num">&#9314;</span><span>{t('verifyStep3')}</span></li>
          </ol>
          <div className="auth-verify-links">
            <a href={`${process.env.PUBLIC_URL}/audit-report.html`} target="_blank" rel="noreferrer">{t('auditReportTitle')}</a>
            <a href={`${process.env.PUBLIC_URL}/verify-guide.html`} target="_blank" rel="noreferrer">{t('verifyGuideTitle')}</a>
            <a href={`${process.env.PUBLIC_URL}/security.html`} target="_blank" rel="noreferrer">{t('securityGuideTitle')}</a>
          </div>
        </section>

        <details className="auth-disclose">
          <summary>
            <span>{t('landingEvidenceSummary')}</span>
            <small aria-hidden="true">+</small>
          </summary>
          <div className="auth-evidence-body">
            <strong className="auth-evidence-label">{t('ipfsPanelTitle')}</strong>
            <p className="auth-ipfs-warning">{t('ipfsPanelSubtitle')}</p>
            <div className="auth-ipfs-panel">
            <IpfsLinkGroup
              title={t('ipfsGameTitle')}
              links={gameIpfsLinks}
              health={gatewayHealth}
              pendingText={t('ipfsPending')}
              gatewayText={t('ipfsGateway')}
              checkingText={t('gatewayChecking')}
              goodText={t('gatewayGood')}
              slowText={t('gatewaySlow')}
              badText={t('gatewayBad')}
              latencyText={t('gatewayLatency')}
            />
            <IpfsLinkGroup
              title={t('ipfsSourceTitle')}
              links={sourceIpfsLinks}
              health={gatewayHealth}
              pendingText={t('ipfsPending')}
              gatewayText={t('ipfsGateway')}
              checkingText={t('gatewayChecking')}
              goodText={t('gatewayGood')}
              slowText={t('gatewaySlow')}
              badText={t('gatewayBad')}
              latencyText={t('gatewayLatency')}
            />
          </div>
            <div className="auth-evidence-rail" aria-label={t('evidenceChain')}>
              <div>
                <span>{t('evidenceSourceLabel')}</span>
                <strong>{t('evidenceSource')}</strong>
              </div>
              <div>
                <span>{t('evidenceBuildLabel')}</span>
                <strong>{t('evidenceBuild')}</strong>
              </div>
              <div>
                <span>{t('evidenceIpfsLabel')}</span>
                <strong>{t('evidenceIpfs')}</strong>
              </div>
              <div>
                <span>{t('evidenceGameLabel')}</span>
                <strong>{t('evidenceGame')}</strong>
              </div>
            </div>
            <div className="auth-audit-card">
              <div>
                <strong>{t('auditReportTitle')}</strong>
                <small>{t('auditReportText')}</small>
              </div>
              <a href={`${process.env.PUBLIC_URL}/audit-report.html`} target="_blank" rel="noreferrer">
                {t('auditReportOpen')}
              </a>
            </div>
            <div className="auth-resource-grid">
              <a href={`${process.env.PUBLIC_URL}/verify-guide.html`} target="_blank" rel="noreferrer">
                <strong>{t('verifyGuideTitle')}</strong>
                <small>{t('verifyGuideText')}</small>
                <span>{t('verifyGuideOpen')}</span>
              </a>
              <a href={`${process.env.PUBLIC_URL}/security.html`} target="_blank" rel="noreferrer">
                <strong>{t('securityGuideTitle')}</strong>
                <small>{t('securityGuideText')}</small>
                <span>{t('securityGuideOpen')}</span>
              </a>
            </div>
          </div>
        </details>

        <details className="auth-disclose">
          <summary>
            <span>{t('assuranceMatrixTitle')}</span>
            <small aria-hidden="true">+</small>
          </summary>
          <section className="auth-assurance-matrix" aria-label={t('assuranceMatrixTitle')}>
          <div className="auth-assurance-matrix-head">
            <span>{t('assuranceMatrixKicker')}</span>
            <strong>{t('assuranceMatrixTitle')}</strong>
            <small>{t('assuranceMatrixCopy')}</small>
          </div>
          <div className="auth-assurance-list">
            {auditStatus.programs.map(program => (
              <AuditProgramCard key={program.id} program={program} />
            ))}
          </div>
          <div className="auth-assurance-footer">
            <span>{t('assuranceMatrixUpdated', {date: auditStatus.generatedAt.slice(0, 10)})}</span>
            <a href={`${process.env.PUBLIC_URL}/audit/status.json`} target="_blank" rel="noreferrer">
              {t('assuranceMatrixJson')}
            </a>
          </div>
          </section>
        </details>

        <details className="auth-disclose">
          <summary>
            <span>{t('landingDetailsSummary')}</span>
            <small aria-hidden="true">+</small>
          </summary>
        <section className="auth-faq-panel" aria-label={t('faqTitle')}>
          <div className="auth-faq-head">
            <span>{t('faqKicker')}</span>
            <h2>{t('faqTitle')}</h2>
            <p>{t('faqCopy')}</p>
            <a className="auth-faq-reproduce" href={`${process.env.PUBLIC_URL}/verify-guide.html#reproduce`} target="_blank" rel="noreferrer">{t('faqReproduceLink')}</a>
          </div>
          <div className="auth-faq-grid">
            {faqRows.map((item, index) => (
              <article className="auth-faq-item" key={item.question}>
                <div className="auth-faq-index">{String(index + 1).padStart(2, '0')}</div>
                <h3>{t(item.question)}</h3>
                <p>{t(item.answer)}</p>
                <details className="auth-faq-code">
                  <summary>{t('faqCodeSummary')}</summary>
                  <div className="auth-faq-source">{item.source}</div>
                  <pre><code>{item.code}</code></pre>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section className="auth-comparison-panel" aria-label={t('comparisonTitle')}>
          <div className="auth-comparison-head">
            <span>{t('comparisonKicker')}</span>
            <h2>{t('comparisonTitle')}</h2>
            <p>{t('comparisonCopy')}</p>
          </div>
          <div className="auth-comparison-table" role="table" aria-label={t('comparisonTitle')}>
            <div className="auth-comparison-row auth-comparison-header" role="row">
              <span role="columnheader">{t('comparisonColType')}</span>
              <span role="columnheader">{t('comparisonColStrength')}</span>
              <span role="columnheader">{t('comparisonColVerify')}</span>
              <span role="columnheader">{t('comparisonColFairPoker')}</span>
            </div>
            {comparisonRows.map((row) => (
              <div className="auth-comparison-row" role="row" key={row[0]}>
                <strong role="cell" data-label={t('comparisonColType')}>{t(row[0])}</strong>
                <span role="cell" data-label={t('comparisonColStrength')}>{t(row[1])}</span>
                <span role="cell" data-label={t('comparisonColVerify')}>{t(row[2])}</span>
                <em role="cell" data-label={t('comparisonColFairPoker')}>{t(row[3])}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="auth-legal-band" aria-label={t('legalNoticeAria')}>
          <article className="auth-legal-intro">
            <header className="auth-legal-heading">
              <strong>{t('legalTitle')}</strong>
            </header>
            <p>{t('legalCopy')}</p>
            <div className="auth-legal-contact">
              <header className="auth-legal-heading">
                <strong>{t('contactTitle')}</strong>
              </header>
              <p>
                {t('contactText')}{' '}
                <a href="mailto:support@fairpoker.app">support@fairpoker.app</a>
              </p>
            </div>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('complianceTitle')}</strong>
            </header>
            <p>{t('complianceText')}</p>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('accessTitle')}</strong>
            </header>
            <p>{t('accessText')}</p>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('privacyTitle')}</strong>
            </header>
            <p>{t('privacyText')}</p>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('cookieTitle')}</strong>
            </header>
            <p>{t('cookieText')}</p>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('disclaimerTitle')}</strong>
            </header>
            <p>{t('disclaimerText')}</p>
          </article>
          <article>
            <header className="auth-legal-heading">
              <strong>{t('licenseLegalTitle')}</strong>
            </header>
            <p>{t('licenseLegalText')}</p>
          </article>
        </section>
        </details>

        <footer className="auth-footer">
          <div className="auth-footer-brand">
            <span className="auth-footer-mark">&#9824;</span>
            <strong>Fair Poker</strong>
          </div>
          <p className="auth-footer-disclaimer">{t('landingFooterNote')}</p>
          <nav className="auth-footer-legal" aria-label="Site">
            <a href={`${process.env.PUBLIC_URL}/audit-report.html`}>{t('navEvidence')}</a>
            <a href={`${process.env.PUBLIC_URL}/verify-guide.html`}>{t('navVerify')}</a>
            <a href={`${process.env.PUBLIC_URL}/security.html`}>{t('navSecurity')}</a>
            <a href={`${process.env.PUBLIC_URL}/roadmap.html`}>{t('navRoadmap')}</a>
            <a href={`${process.env.PUBLIC_URL}/privacy.html`}>{t('footerPrivacy')}</a>
            <a href={`${process.env.PUBLIC_URL}/terms.html`}>{t('footerTerms')}</a>
            <a href={`${process.env.PUBLIC_URL}/cookies.html`}>{t('footerCookies')}</a>
            <a href={`${process.env.PUBLIC_URL}/responsible-play.html`}>{t('footerResponsible')}</a>
            <a href="mailto:support@fairpoker.app">support@fairpoker.app</a>
          </nav>
          <p className="auth-footer-license">{t('licenseText')}</p>
        </footer>
      </main>
    </div>
  );
}

function AccountEntryForm(props: {
  username: string;
  setUsername: (username: string) => void;
  password: string;
  setPassword: (password: string) => void;
  busy: boolean;
  error: string;
  submit: (event: FormEvent) => void;
  compact?: boolean;
}) {
  const {t} = useI18n();
  const autoCreateCopy = t('accountEntryAutoCreate');
  const assurancePoints = [
    t('accountEntryPoint1'),
    t('accountEntryPoint2'),
    t('accountEntryPoint3'),
  ].filter(Boolean);

  return (
    <form className={`auth-account-form${props.compact ? ' auth-account-form-compact' : ''}`} onSubmit={props.submit}>
      {!props.compact && (
        <div className="auth-entry-head">
          <span>{t('entryKicker')}</span>
          <h2>{t('accountEntryTitle')}</h2>
          <p>{t('accountEntryCopy')}</p>
        </div>
      )}

      {autoCreateCopy && <div className="auth-member-note">{autoCreateCopy}</div>}

      <div className="auth-form-grid">
        <label className="auth-field">
          <span>{t('username')}</span>
          <input
            type="text"
            value={props.username}
            onChange={event => props.setUsername(event.target.value)}
            autoComplete="username"
            placeholder={t('usernamePlaceholder')}
          />
        </label>
        <label className="auth-field">
          <span>{t('password')}</span>
          <input
            type="password"
            value={props.password}
            onChange={event => props.setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder={t('passwordPlaceholder')}
          />
        </label>
      </div>

      {props.error && <div className="auth-error">{props.error}</div>}

      <button className="auth-primary" type="submit" disabled={props.busy}>
        {props.busy ? t('working') : t('accountEntrySubmit')}
      </button>

      {assurancePoints.length > 0 && (
        <div className="auth-entry-assurance">
          {assurancePoints.map(point => <span key={point}>{point}</span>)}
        </div>
      )}
    </form>
  );
}

function AuditProgramCard(props: {program: AuditProgram}) {
  const {t} = useI18n();
  const href = auditProgramHref(props.program.reportUrl);
  const statusText = statusLabel(props.program.status, t);
  const title = auditProgramTitle(props.program.id, t);
  const meta = auditProgramMeta(props.program.id, props.program, t);
  return (
    <article className={`auth-assurance-item auth-assurance-${props.program.status}`}>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      <em>{statusText}</em>
      {href && (
        <a href={href} target="_blank" rel="noreferrer">
          {t('assuranceMatrixOpen')}
        </a>
      )}
    </article>
  );
}

function auditProgramTitle(id: string, t: ReturnType<typeof useI18n>['t']) {
  switch (id) {
    case 'github-public-evidence':
      return t('auditProgramGithubEvidenceTitle');
    case 'github-security-advisories':
      return t('auditProgramGithubAdvisoriesTitle');
    case 'snyk':
      return t('auditProgramSnykTitle');
    case 'openssf-scorecard':
      return t('auditProgramScorecardTitle');
    case 'codeql':
      return t('auditProgramCodeqlTitle');
    case 'dependabot':
      return t('auditProgramDependabotTitle');
    case 'npm-audit':
      return t('auditProgramNpmTitle');
    case 'source-release-evidence':
      return t('auditProgramSourceTitle');
    case 'transcript-verifier':
      return t('auditProgramTranscriptTitle');
    case 'live-fairness-audit-overlay':
      return t('auditProgramFairnessOverlayTitle');
    case 'browser-authoritative-state':
      return t('auditProgramBrowserStateTitle');
    case 'end-to-end-card-key-sealing':
      return t('auditProgramCardSealingTitle');
    default:
      return id;
  }
}

function auditProgramMeta(id: string, program: AuditProgram, t: ReturnType<typeof useI18n>['t']) {
  switch (id) {
    case 'github-public-evidence':
      return t('auditProgramGithubEvidenceMeta');
    case 'github-security-advisories':
      return t('auditProgramGithubAdvisoriesMeta');
    case 'snyk':
      return t('auditProgramSnykMeta');
    case 'openssf-scorecard':
      return t('auditProgramScorecardMeta');
    case 'codeql':
      return t('auditProgramCodeqlMeta');
    case 'dependabot':
      return t('auditProgramDependabotMeta');
    case 'npm-audit':
      return program.metrics?.total === 0
        ? t('auditProgramNpmClean')
        : t('auditProgramNpmFindings', {count: program.metrics?.total ?? 0});
    case 'source-release-evidence':
      return t('auditProgramSourceMeta');
    case 'transcript-verifier':
      return t('auditProgramTranscriptMeta');
    case 'live-fairness-audit-overlay':
      return t('auditProgramFairnessOverlayMeta');
    case 'browser-authoritative-state':
      return t('auditProgramBrowserStateMeta');
    case 'end-to-end-card-key-sealing':
      return t('auditProgramCardSealingMeta');
    default:
      return program.providers.join(' · ');
  }
}

function statusLabel(status: AuditProgram['status'], t: ReturnType<typeof useI18n>['t']) {
  switch (status) {
    case 'active':
      return t('auditStatusActive');
    case 'continuous':
      return t('auditStatusContinuous');
    case 'planned':
      return t('auditStatusPlanned');
    case 'needs-review':
      return t('auditStatusNeedsReview');
    case 'unavailable':
      return t('auditStatusUnavailable');
    default:
      return status;
  }
}

function IpfsLinkGroup(props: {
  title: string;
  links: IpfsLink[];
  health: Record<string, GatewayHealth>;
  pendingText: string;
  gatewayText: string;
  checkingText: string;
  goodText: string;
  slowText: string;
  badText: string;
  latencyText: string;
}) {
  const statusText = (health: GatewayHealth) => {
    switch (health.status) {
      case 'good':
        return health.latencyMs ? `${props.goodText} · ${props.latencyText.replace('{ms}', String(health.latencyMs))}` : props.goodText;
      case 'slow':
        return health.latencyMs ? `${props.slowText} · ${props.latencyText.replace('{ms}', String(health.latencyMs))}` : props.slowText;
      case 'bad':
        return props.badText;
      case 'checking':
      default:
        return '';
    }
  };

  return (
    <div className="auth-ipfs-group">
      <span>{props.title}</span>
      {props.links.length === 0 ? (
        <em>{props.pendingText}</em>
      ) : (
        <div>
          {props.links.map(link => {
            const linkHealth = props.health[link.href] ?? {status: 'checking' as GatewayHealthStatus};
            const healthLabel = statusText(linkHealth);
            return (
              <a
                key={`${props.title}-${link.href}`}
                className={`auth-ipfs-link auth-ipfs-link-${linkHealth.status}`}
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                <span className="auth-ipfs-link-head">
                  <small>{link.host}</small>
                  <span className="auth-ipfs-health">
                    <i aria-hidden="true" />
                    {healthLabel && <b>{healthLabel}</b>}
                  </span>
                </span>
                <strong>{link.label}</strong>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

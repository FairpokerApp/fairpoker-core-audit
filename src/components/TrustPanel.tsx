import React, {useEffect, useMemo, useState} from "react";
import Modal from "./Modal";
import {Chat, TexasHoldem} from "../lib/setup";
import {TranscriptSnapshot, verifyTranscript} from "../lib/fairness/transcript";
import {getRuntimeCodeSource} from "../lib/runtimeCodeSource";
import {ClientVersionClaim, getClientVersionClaim} from "../lib/clientVersion";
import {getCachedRuntimeReleaseIdentity, loadRuntimeReleaseIdentity, RuntimeReleaseIdentity} from "../lib/runtimeReleaseIdentity";
import {useI18n, useLocalizedText} from "../lib/i18n";

type LocalVerificationResult =
  | { status: 'idle' }
  | { status: 'passed'; finalHash?: string }
  | { status: 'failed'; reason: string };

type FairnessFaqStatus = 'solved' | 'partial' | 'open';
type FairnessFaqCategory = 'control' | 'code' | 'records' | 'ops';

interface FairnessFaqItem {
  category: FairnessFaqCategory;
  questionCn: string;
  questionEn: string;
  status: FairnessFaqStatus;
  statusText: string;
  answer: string;
  explanation: string;
  technical: string;
  verification: string;
  references: Array<{
    label: string;
    path: string;
    snippet: string;
  }>;
}

const faqCategories: Array<{
  id: FairnessFaqCategory;
  label: string;
  caption: string;
}> = [
  { id: 'control', label: '控牌', caption: 'Cards' },
  { id: 'code', label: '代码', caption: 'Code' },
  { id: 'records', label: '记录', caption: 'Proof' },
  { id: 'ops', label: '运维', caption: 'Ops' },
];

const trustProtocolCards = [
  {
    label: '01',
    title: '服务器不发牌 / No dealer',
    text: '牌序和密钥在浏览器形成；平台只转发消息。 / Deck and keys stay in browsers.',
  },
  {
    label: '02',
    title: '入口可核验 / Checkable code',
    text: '固定入口和源码指纹确认同一份前端。 / Fixed entry and fingerprint.',
  },
  {
    label: '03',
    title: '记录可复验 / Replayable',
    text: '事件形成 transcript，可下载检查 hash-chain。 / Download and verify locally.',
  },
];

const fairnessFaqItems: FairnessFaqItem[] = [
  {
    category: 'control',
    questionCn: '平台能不能给自己或指定账号发好牌？',
    questionEn: 'Can the operator deal itself good cards?',
    status: 'solved',
    statusText: '不能 / No',
    answer: '不能由平台单方面决定。牌局的洗牌、加密和解密流程在玩家浏览器内执行，服务端只承担消息转发职责。',
    explanation: '关键约束是“多方参与”：每位玩家都会参与洗牌或加密过程，最终发牌需要对应卡位的解密材料逐步公开。',
    technical: '每局按 participants 顺序触发 start、deck/shuffle、deck/lock、deck/finalized，之后 dealCard/showCard 只公开指定卡位所需的解密 key。',
    verification: '下载 transcript 后检查：每位玩家都应各有一次 deck/shuffle 和 deck/lock，最后才允许发牌。',
    references: [
      {
        label: '牌局启动时把参与者写入 mental-poker 设置',
        path: 'app/src/lib/texas-holdem/TexasHoldemGameRoom.ts',
        snippet: `this.round = await this.mentalPokerGameRoom.startNewRound({
  participants: playersOrdered,
  bits: normalizedSettings.bits,
});`,
      },
      {
        label: 'mental-poker 事件类型限定为洗牌、锁牌、定稿、解密',
        path: 'app/src/lib/MentalPokerGameRoom.ts',
        snippet: `export type MentalPokerEvent =
  | RoundStartEvent
  | DeckShuffleEvent
  | DeckLockEvent
  | DeckFinalizedEvent
  | DecryptCardEvent;`,
      },
    ],
  },
  {
    category: 'code',
    questionCn: '运营方如果替换前端代码，如何发现？',
    questionEn: 'What if the code is secretly changed?',
    status: 'solved',
    statusText: 'CID 锁住 / CID lock',
    answer: '公开公平入口应使用固定 IPFS CID。可以把 IPFS 理解成去中心化的公开文件网络；前端文件只要发生变化，CID 就会变化。',
    explanation: '这里依赖内容寻址，而不是依赖域名或运营方声明。CID 像“文件自己生成的防伪码”，任何 IPFS 浏览器或公共网关打开同一 CID，都应拿到同一份 App。',
    technical: 'IPFS 不是中心服务器，也不是单独的区块链账本；它是常和区块链生态配合使用的去中心化内容寻址存储网络。运行时会解析当前 URL 是否来自 IPFS CID；非 IPFS 入口会明确显示为本地验收入口或域名镜像入口。',
    verification: '公开公平入口地址应包含 /ipfs/CID 或 CID 子域名；本面板“代码入口”应显示 IPFS 固定入口。',
    references: [
      {
        label: '从 URL 识别 IPFS CID',
        path: 'app/src/lib/runtimeCodeSource.ts',
        snippet: `const pathParts = url.pathname.split('/').filter(Boolean);
const ipfsIndex = pathParts.indexOf('ipfs');
if (ipfsIndex >= 0) {
  const candidate = pathParts[ipfsIndex + 1];
  return candidate && CID_PATTERN.test(candidate) ? candidate : undefined;
}`,
      },
      {
        label: '非 IPFS 入口标记为验收或镜像入口',
        path: 'app/src/lib/runtimeCodeSource.ts',
        snippet: `return {
  kind: 'web',
  label: '域名镜像入口 / Domain Mirror',
  trusted: false,
};`,
      },
    ],
  },
  {
    category: 'code',
    questionCn: '如何降低前端代码暗藏后门的风险？',
    questionEn: 'What if there is a hidden backdoor?',
    status: 'solved',
    statusText: '可审计 / Auditable',
    answer: '不能仅依赖运营方声明。应公开源码、锁定依赖、固定构建产物，并允许第三方从源码复核。',
    explanation: '专业审计关注的是可复现证据：源码、依赖锁文件、构建脚本、发布清单、最终 CID 必须能相互对应。',
    technical: '源码包、依赖锁文件、构建脚本、发布清单和最终 IPFS build 都要固定。任何人可以从源码重新构建，并对比产物 hash/CID 是否一致。',
    verification: '检查源码包 CID、源码 SHA256、发布清单、构建产物 CID 和页面显示的源码指纹是否相互对应。',
    references: [
      {
        label: '客户端展示发布元数据与源码指纹',
        path: 'app/src/components/TrustPanel.tsx',
        snippet: `<dt>源码指纹<br/><small>Fingerprint</small></dt>
<dd>{runtimeReleaseIdentity.sourceFingerprint}</dd>`,
      },
      {
        label: '发布元数据由构建脚本生成',
        path: 'app/scripts/generate-release-metadata.js',
        snippet: `const metadata = {
  appName,
  appVersion,
  sourceCommit,
  sourceFingerprint,
};`,
      },
    ],
  },
  {
    category: 'control',
    questionCn: 'Cloudflare Worker 能不能偷看或改牌？',
    questionEn: 'Can the Worker see or change cards?',
    status: 'solved',
    statusText: '仅中继 / Relay',
    answer: 'Worker 不持有洗牌私钥，也不执行发牌逻辑。它是 Cloudflare 全球边缘网络上的轻量 WebSocket 中继，接收消息后只转发给房间内目标玩家。',
    explanation: 'Fair Poker 没有传统发牌服务器或自建 VPS 牌桌后端；Cloudflare Worker 把中继层压缩成高可用传输层，同时不具备生成随机数、洗牌、解密、判定胜负的业务权限。',
    technical: 'Worker 是边缘中继，不纳入核心公平源码包的发牌信任边界。公开客户端把它当作不可信传输层：只接受玩家签名事件，并在本地 transcript 中复验。',
    verification: '如果 Worker 伪造或篡改玩家事件，客户端签名校验、transcript 验证和结果复算会失败；Cloudflare Worker 的价值是稳定转发，而不是参与发牌、看牌或结算。',
    references: [
      {
        label: '客户端只把中继当作不可信传输层',
        path: 'app/src/lib/CloudflareRelayTransport.ts',
        snippet: `this.socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  this.listener.emit('message', message.data, message.from);
});`,
      },
      {
        label: '牌局事件进入 hash-chain transcript 后复验',
        path: 'app/src/lib/fairness/transcript.ts',
        snippet: `const eventHash = await hashTranscriptEntry(entry);
if (entry.previousHash !== previousHash) {
  return { ok: false, failedIndex: index };
}`,
      },
    ],
  },
  {
    category: 'code',
    questionCn: '不同玩家会不会打开不同版本？',
    questionEn: 'Could players load different versions?',
    status: 'solved',
    statusText: '同入口 / Same entry',
    answer: '公开牌局应要求所有玩家从同一个 IPFS CID 进入，并在桌内交换版本声明。',
    explanation: '版本一致性需要在客户端显示和核验，不应只依赖聊天约定或运营方说明。',
    technical: '客户端会上报 appVersion、sourceFingerprint、runtimeKind、runtimeCid。桌内版本不一致时会显示风险。',
    verification: '所有玩家打开后，本面板“代码入口”和“桌内版本”应一致。',
    references: [
      {
        label: '客户端版本声明字段',
        path: 'app/src/lib/clientVersion.ts',
        snippet: `return {
  appVersion: runtimeReleaseIdentity.appVersion,
  sourceFingerprint: runtimeReleaseIdentity.sourceFingerprint,
  runtimeKind: runtime.kind,
  runtimeLabel: runtime.label,
  ...(runtime.kind === 'ipfs' ? { runtimeCid: runtime.cid } : {}),
};`,
      },
      {
        label: '桌内对比远端版本声明',
        path: 'app/src/components/TrustPanel.tsx',
        snippet: `const allMatch = Array.from(clientVersionClaims.values()).every((claim) =>
  claim.appVersion === localVersionClaim.appVersion
  && claim.sourceFingerprint === localVersionClaim.sourceFingerprint
  && claim.runtimeKind === localVersionClaim.runtimeKind
  && claim.runtimeCid === localVersionClaim.runtimeCid
);`,
      },
    ],
  },
  {
    category: 'control',
    questionCn: '只要一位玩家诚实，为什么就够？',
    questionEn: 'Why is one honest player enough?',
    status: 'solved',
    statusText: '多人洗牌 / Multi-party',
    answer: '因为每位参与者都会重新洗牌并加密。只要至少一位参与者没有泄露自己的随机性和解密材料，其他人就不能单独推出最终牌序。',
    explanation: '这是 mental-poker 的核心假设：公平性由多方随机性叠加，而不是由单一服务器随机数决定。',
    technical: '每个 participant 都在本地生成密钥，使用 crypto.getRandomValues 做无偏 Fisher-Yates 洗牌并重新加密。最终开牌需要对应卡位的所有玩家解密钥匙。',
    verification: '测试覆盖三人参与洗牌、强随机来源和拒绝采样；transcript 可检查所有参与者是否都完成 shuffle/lock。',
    references: [
      {
        label: '浏览器强随机源',
        path: 'app/src/lib/cryptoShuffle.ts',
        snippet: `const sample = new Uint32Array(1);
const cryptoApi = getCrypto();
cryptoApi.getRandomValues(sample);`,
      },
      {
        label: '无偏 Fisher-Yates 洗牌',
        path: 'app/src/lib/cryptoShuffle.ts',
        snippet: `for (let i = deck.cards.length - 1; i > 0; i -= 1) {
  const j = secureRandomIntBelow(i + 1);
  if (i !== j) {
    const card = deck.cards[i];
    deck.cards[i] = deck.cards[j];
    deck.cards[j] = card;
  }
}`,
      },
    ],
  },
  {
    category: 'control',
    questionCn: 'IPFS 网关能不能知道牌？',
    questionEn: 'Can IPFS gateway know cards?',
    status: 'solved',
    statusText: '不知道 / No secrets',
    answer: '不能。IPFS 网关只提供静态前端文件，不参与运行时牌局，也不接收玩家的本地私钥。',
    explanation: 'IPFS 的角色是固定代码来源，类似把前端 App 放在一个去中心化公开文件网络里；牌局随机数、洗牌密钥和开牌密钥都在浏览器运行时产生。',
    technical: 'IPFS CID 固定的是静态前端文件。任何 IPFS 浏览器或网关只是按 CID 取文件，不参与 WebSocket 牌局，不生成随机数，不保存洗牌密钥。',
    verification: 'transcript 里的洗牌身份应是玩家 peerId，不是 IPFS 网关或服务器。',
    references: [
      {
        label: '运行时来源只识别代码入口',
        path: 'app/src/lib/runtimeCodeSource.ts',
        snippet: `if (cid) {
  return {
    kind: 'ipfs',
    cid,
    label: 'IPFS 固定入口 / Fixed IPFS',
    trusted: true,
  };
}`,
      },
      {
        label: '洗牌密钥在玩家本地创建',
        path: 'app/src/lib/MentalPokerGameRoom.ts',
        snippet: `const playerPromise = createPlayer({
  cards: CARDS,
  bits: settings.bits ?? DEFAULT_MENTAL_POKER_BITS,
});`,
      },
    ],
  },
  {
    category: 'records',
    questionCn: '赢家和奖池能不能乱算？',
    questionEn: 'Can winner or pot be faked?',
    status: 'solved',
    statusText: '可复算 / Replayable',
    answer: '不应以服务器返回值作为唯一依据。客户端可根据 transcript 中的事件顺序重放下注、奖池和胜负结果。',
    explanation: '可复算性要求每一步状态变化都来自签名事件，而不是来自不可见的服务器内部状态。',
    technical: '客户端会按德州扑克规则复算下注、奖池、赢家和最终资金变化。',
    verification: '用 transcript 验证器重放本局事件，核对赢家、奖池和最终 hash。',
    references: [
      {
        label: '下注事件只记录 round 与 amount，由发送者身份确定 who',
        path: 'app/src/lib/texas-holdem/TexasHoldemGameRoom.ts',
        snippet: `async bet(round: number, amount: number) {
  await this.gameRoom.emitEvent({
    type: 'public',
    sender: await this.gameRoom.peerIdAsync,
    data: { type: 'action/bet', round, amount },
  });
}`,
      },
      {
        label: '奖池由每位玩家下注累加得到',
        path: 'app/src/lib/texas-holdem/TexasHoldemGameRoom.ts',
        snippet: `pot.set(who, totalBetAmount);
const potTotalAmount = Array.from(round.pot.values())
  .reduce((a, b) => a + b, 0);
this.emitter.emit('pot', roundNo, potTotalAmount);`,
      },
    ],
  },
  {
    category: 'records',
    questionCn: '运营方删除服务器记录怎么办？',
    questionEn: 'What if records are deleted?',
    status: 'solved',
    statusText: '本地封存 / Local sealed',
    answer: '玩家下载到本地的 transcript 不依赖服务器保留。服务器删记录，也不会删除玩家手里的审计证据。',
    explanation: '当前版本把每局关键事件做成本地可下载、可验证的 hash-chain 记录，玩家自己就能保全证据。',
    technical: '本局 transcript 在玩家本地生成，可下载保存；finalHash 用于核对记录是否被修改。',
    verification: '牌局结束后下载 transcript，使用本地检查按钮或验证器复验 finalHash。',
    references: [
      {
        label: '本地 transcript 使用 hash chain 记录每个事件',
        path: 'app/src/lib/fairness/transcript.ts',
        snippet: `const eventHash = \`sha256:\${await sha256Hex(canonicalJson({
  ...unsignedEntry,
  previousHash: this.latestHash,
}))}\`;
this.entries.push(entry);
this.latestHash = eventHash;`,
      },
      {
        label: '下载内容来自客户端当前 snapshot',
        path: 'app/src/components/TrustPanel.tsx',
        snippet: `const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
  type: 'application/json',
});`,
      },
    ],
  },
  {
    category: 'ops',
    questionCn: 'IPFS 是不是永久在线？',
    questionEn: 'Is IPFS always online?',
    status: 'solved',
    statusText: '多网关 / Multi-gateway',
    answer: 'IPFS CID 可以证明内容未被替换；任何 IPFS 浏览器或公共网关都可以用同一个 CID 打开这份前端 App。',
    explanation: 'IPFS 是去中心化内容寻址存储网络，常和区块链生态一起使用。它解决的是“文件是否同一份”；长期可访问性还需要 pin 节点或公共网关持续提供文件。',
    technical: 'CID 负责内容寻址和防篡改，持久可访问依赖 pin 节点或第三方 pin 服务。',
    verification: '用多个公共网关打开同一 CID，并确认页面版本、源码指纹和发布清单一致。',
    references: [
      {
        label: '客户端只把 CID 识别为可信入口，不声明永久可用',
        path: 'app/src/lib/runtimeCodeSource.ts',
        snippet: `label: 'IPFS 固定入口 / Fixed IPFS',
detail: \`当前页面从 IPFS CID 打开 / Loaded from IPFS CID: \${cid}\`,
trusted: true,`,
      },
    ],
  },
  {
    category: 'ops',
    questionCn: '怎么确认我打开的是公开公平入口？',
    questionEn: 'How do I know this is the official entry?',
    status: 'solved',
    statusText: '可核对 / Checkable',
    answer: '看浏览器地址里的 IPFS CID。公开公平入口是一串固定 CID；文件被改 1 个字节，CID 就会变。',
    explanation: '可以把 CID 理解成“文件本身生成的防伪码”。不是平台随便贴一个号码，而是 IPFS 按内容寻址，地址和文件绑定；任何 IPFS 浏览器或网关打开同一 CID，都应运行同一份 App。',
    technical: '客户端会识别当前 URL 是否来自 IPFS CID，并显示 Fixed IPFS 状态。域名镜像或本地验收入口不作为唯一公平核验依据。',
    verification: '打开公平机制面板，入口状态应显示 IPFS 固定入口；发布清单 release-manifest.json 应从同一个 CID 目录读取。',
    references: [
      {
        label: 'IPFS 地址会被识别为固定入口',
        path: 'app/src/lib/runtimeCodeSource.ts',
        snippet: `const cid = findIpfsCid(url);
if (cid) {
  return {
    kind: 'ipfs',
    label: 'IPFS 固定入口 / Fixed IPFS',
    trusted: true,
  };
}`,
      },
      {
        label: '发布清单随正式 build 一起发布',
        path: 'app/src/components/TrustPanel.tsx',
        snippet: `{RELEASE_METADATA.releaseManifestUrl && (
  <a href={RELEASE_METADATA.releaseManifestUrl}>release-manifest.json</a>
)}`,
      },
    ],
  },
];

function readTranscriptSnapshot(): TranscriptSnapshot<unknown> | null {
  return (TexasHoldem as any)?.getTranscript?.() ?? null;
}

function downloadTranscript() {
  const snapshot = readTranscriptSnapshot();
  if (!snapshot) {
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

export default function TrustPanel() {
  const {language} = useI18n();
  const localize = useLocalizedText();
  const [visible, setVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<FairnessFaqCategory>('control');
  const [transcript, setTranscript] = useState<TranscriptSnapshot<unknown> | null>(() => readTranscriptSnapshot());
  const [localVerification, setLocalVerification] = useState<LocalVerificationResult>({status: 'idle'});
  const [clientVersionClaims, setClientVersionClaims] = useState<Map<string, ClientVersionClaim>>(new Map());
  const [runtimeReleaseIdentity, setRuntimeReleaseIdentity] = useState<RuntimeReleaseIdentity>(() => getCachedRuntimeReleaseIdentity());
  const signatureVerified = Boolean(runtimeReleaseIdentity.sourceFingerprint);
  const runtimeCodeSource = getRuntimeCodeSource();
  const localVersionClaim = useMemo(() => getClientVersionClaim(), [runtimeReleaseIdentity]);
  const activeFaqItems = useMemo(
    () => fairnessFaqItems.filter((item) => item.category === activeCategory),
    [activeCategory],
  );
  const tableVersionStatus = useMemo(() => {
    if (!runtimeCodeSource.trusted) {
      return {
        good: false,
        text: '非 CID 入口 / Mirror',
      };
    }
    if (clientVersionClaims.size === 0) {
      return {
        good: false,
        text: '等待上报 / Waiting',
      };
    }
    const allMatch = Array.from(clientVersionClaims.values()).every((claim) =>
      claim.appVersion === localVersionClaim.appVersion
      && claim.sourceFingerprint === localVersionClaim.sourceFingerprint
      && claim.runtimeKind === localVersionClaim.runtimeKind
      && claim.runtimeCid === localVersionClaim.runtimeCid
    );
    return {
      good: allMatch,
      text: allMatch ? '版本一致 / Matched' : '版本不一致 / Mismatch',
    };
  }, [clientVersionClaims, localVersionClaim, runtimeCodeSource.trusted]);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeReleaseIdentity()
      .then(identity => {
        if (!cancelled) {
          setRuntimeReleaseIdentity(identity);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const runLocalVerification = async () => {
    const snapshot = readTranscriptSnapshot();
    if (!snapshot || snapshot.entries.length === 0) {
      setLocalVerification({status: 'failed', reason: '还没有 transcript 事件 / No transcript events yet'});
      return;
    }
    const result = await verifyTranscript(snapshot);
    if (result.ok) {
      setLocalVerification({status: 'passed', finalHash: result.finalHash});
    } else {
      setLocalVerification({
        status: 'failed',
        reason: result.reason ?? `第 ${result.failedIndex ?? '?'} 条事件验证失败`,
      });
    }
  };

  useEffect(() => {
    const listener = () => {
      setTranscript(readTranscriptSnapshot());
    };
    (TexasHoldem as any)?.listener?.on?.('transcript', listener);
    listener();
    return () => {
      (TexasHoldem as any)?.listener?.off?.('transcript', listener);
    };
  }, []);

  useEffect(() => {
    const listener = (claim: ClientVersionClaim, whose: string) => {
      setClientVersionClaims(prev => {
        const next = new Map(prev);
        next.set(whose, claim);
        return next;
      });
    };
    Chat?.listener?.on?.('clientVersion', listener);
    void Chat?.announceClientVersion?.(localVersionClaim);
    return () => {
      Chat?.listener?.off?.('clientVersion', listener);
    };
  }, [localVersionClaim]);

  return (
    <>
      <button
        className="trust-panel-button"
        data-testid="trust-panel-button"
        onClick={() => setVisible(true)}
        title={localize('查看公平机制和当前代码指纹 / Fairness and code fingerprint')}
        aria-label={localize('查看公平机制 / Open fairness panel')}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M12 3.5l2.4 2 3.1-.2.8 3 2.6 1.7-1.2 2.9 1.2 2.9-2.6 1.7-.8 3-3.1-.2-2.4 2-2.4-2-3.1.2-.8-3-2.6-1.7 1.2-2.9L3.1 10l2.6-1.7.8-3 3.1.2 2.4-2z" />
          <path d="M8.3 12.2l2.4 2.4 5-5" />
        </svg>
      </button>
      <Modal visible={visible} onClick={() => setVisible(false)} data-testid="trust-panel-modal">
        <section className="trust-panel trust-compact" aria-label={localize('公平机制面板 / Fairness trust panel')}>
          <header className="trust-compact-header">
            <div>
              <p className="trust-panel-eyebrow">FAIRNESS PROOF</p>
              <h3>{localize('公平与代码指纹 / Fairness proof')}</h3>
              <small>{localize('服务器不控牌、入口可核验、记录可复验 / No dealer, checkable code, replayable logs.')}</small>
            </div>
            <button className="trust-panel-close" onClick={() => setVisible(false)} aria-label={localize('关闭 / Close')}>×</button>
          </header>

          <section className="trust-summary-grid" aria-label={localize('当前信任状态 / Current trust posture')}>
            <div>
              <span>{localize('发布 / Release')}</span>
              <b className={signatureVerified ? "trust-status-good" : "trust-status-warn"}>
                {signatureVerified ? localize("已发布 / Published") : localize("读取中 / Loading")}
              </b>
            </div>
            <div>
              <span>{localize('入口 / Entry')}</span>
              <b className={runtimeCodeSource.trusted ? "trust-status-good" : "trust-status-warn"}>
                {localize(runtimeCodeSource.label)}
              </b>
            </div>
            <div>
              <span>{localize('版本 / Version')}</span>
              <b className={tableVersionStatus.good ? "trust-status-good" : "trust-status-warn"}>
                {localize(tableVersionStatus.text)}
              </b>
            </div>
            <div>
              <span>{localize('记录 / Logs')}</span>
              <b>{transcript ? `${transcript.entries.length} ${localize('事件 / events')}` : localize('等待 / waiting')}</b>
            </div>
          </section>

          <section className="trust-panel-section trust-compact-section">
            <div className="trust-section-heading">
              <h4>{localize('关键结论 / Key points')}</h4>
              <span>{localize('三点即可 / Top 3')}</span>
            </div>
            <div className="trust-protocol-grid compact">
              {trustProtocolCards.map(item => (
                <article className="trust-protocol-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{localize(item.title)}</strong>
                  <p>{localize(item.text)}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="trust-panel-section trust-compact-section">
            <div className="trust-section-heading">
              <h4>{localize('重点问题 / FAQ')}</h4>
              <span>{localize('按需展开 / Open as needed')}</span>
            </div>
            <div className="trust-category-tabs" role="tablist" aria-label={localize('公平问题分类 / Fairness question categories')}>
              {faqCategories.map(category => (
                <button
                  key={category.id}
                  className={activeCategory === category.id ? 'active' : undefined}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                >
                  <span>{language === 'zh' ? category.label : category.caption}</span>
                </button>
              ))}
            </div>
            <div className="trust-faq-list compact">
              {activeFaqItems.slice(0, 1).map(item => (
                <article className="trust-faq-item" key={item.questionCn}>
                  <div className="trust-faq-heading">
                    <div>
                      <strong>{language === 'zh' ? item.questionCn : item.questionEn}</strong>
                    </div>
                    <span className={`trust-faq-badge trust-faq-badge-${item.status}`}>
                      {localize(item.statusText)}
                    </span>
                  </div>
                  <p className="trust-faq-simple">{localize(item.answer)}</p>
                  <details className="trust-faq-details">
                    <summary>{localize('实现依据 / Evidence')}</summary>
                    <p>{localize(item.explanation)}</p>
                    <p><b>{localize('验证 / Verify')}: </b>{localize(item.verification)}</p>
                  </details>
                </article>
              ))}
            </div>
          </section>

          <div className="trust-panel-actions">
            <button className="trust-download-button" disabled={!transcript || transcript.entries.length === 0} onClick={runLocalVerification}>
              <span>{localize('本地检查 / Verify')}</span>
            </button>
            <button className="trust-download-button" disabled={!transcript || transcript.entries.length === 0} onClick={downloadTranscript}>
              <span>{localize('下载记录 / Transcript')}</span>
            </button>
          </div>

          {localVerification.status !== 'idle' && (
            <p className={localVerification.status === 'passed' ? 'trust-panel-check-good' : 'trust-panel-check-bad'}>
              {localVerification.status === 'passed'
                ? `${localize('本地检查通过 / Verified')}: ${localVerification.finalHash}`
                : `${localize('本地检查失败 / Failed')}: ${localize(localVerification.reason)}`}
            </p>
          )}

          <details className="trust-audit-drawer">
            <summary>
              <span>{localize('审计档案 / Audit archive')}</span>
              <small>{localize('可选 / Advanced')}</small>
            </summary>
            <dl className="trust-panel-metadata">
              <div>
                <dt>{localize('当前入口 / Entry')}</dt>
                <dd title={localize(runtimeCodeSource.detail)}>{localize(runtimeCodeSource.detail)}</dd>
              </div>
              {runtimeCodeSource.kind === 'ipfs' && (
                <div>
                  <dt>{localize('入口 CID / Entry CID')}</dt>
                  <dd title={runtimeCodeSource.cid}>{runtimeCodeSource.cid}</dd>
                </div>
              )}
              <div>
                <dt>App</dt>
                <dd>{runtimeReleaseIdentity.appName} v{runtimeReleaseIdentity.appVersion}</dd>
              </div>
              <div>
                <dt>{localize('源码指纹 / Fingerprint')}</dt>
                <dd className="trust-hash-value" title={runtimeReleaseIdentity.sourceFingerprint || 'ai-json-pending'}>{runtimeReleaseIdentity.sourceFingerprint || 'ai-json-pending'}</dd>
              </div>
              <div>
                <dt>Transcript</dt>
                <dd className="trust-hash-value" title={transcript?.finalHash ?? 'no-events-yet'}>{transcript?.finalHash ?? 'no-events-yet'}</dd>
              </div>
            </dl>
          </details>
        </section>
      </Modal>
    </>
  );
}

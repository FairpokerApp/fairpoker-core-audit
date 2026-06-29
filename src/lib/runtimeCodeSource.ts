export type RuntimeCodeSource =
  | {
      kind: 'ipfs';
      cid: string;
      label: string;
      detail: string;
      trusted: true;
    }
  | {
      kind: 'web' | 'local' | 'unknown';
      label: string;
      detail: string;
      trusted: false;
    };

const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{50,})$/i;

function findIpfsCid(url: URL): string | undefined {
  if (url.protocol === 'ipfs:') {
    const candidate = url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0];
    return CID_PATTERN.test(candidate) ? candidate : undefined;
  }

  const pathParts = url.pathname.split('/').filter(Boolean);
  const ipfsIndex = pathParts.indexOf('ipfs');
  if (ipfsIndex >= 0) {
    const candidate = pathParts[ipfsIndex + 1];
    return candidate && CID_PATTERN.test(candidate) ? candidate : undefined;
  }

  const firstHostPart = url.hostname.split('.')[0];
  return CID_PATTERN.test(firstHostPart) ? firstHostPart : undefined;
}

export function getRuntimeCodeSource(href: string = window.location.href): RuntimeCodeSource {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return {
      kind: 'unknown',
      label: '无法识别 / Unknown',
      detail: '当前浏览器地址无法解析，不能确认代码入口。 / Unable to parse runtime URL.',
      trusted: false,
    };
  }

  const cid = findIpfsCid(url);
  if (cid) {
    return {
      kind: 'ipfs',
      cid,
      label: 'IPFS 固定入口 / Fixed IPFS',
      detail: `当前页面从 IPFS CID 打开。IPFS 是去中心化内容寻址存储网络，任何支持 IPFS 的浏览器或公共网关打开同一 CID，都应得到同一份前端 App。 / Loaded from IPFS CID: ${cid}. IPFS is decentralized content-addressed storage; any IPFS-capable browser or public gateway should load the same app from the same CID.`,
      trusted: true,
    };
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return {
      kind: 'local',
      label: '本地验收入口 / Local Acceptance',
      detail: '当前页面来自本机地址，用于上线前验收；公开牌局请以固定 IPFS CID 入口为准。 / Local acceptance environment; public tables should use the fixed IPFS CID entry.',
      trusted: false,
    };
  }

  return {
    kind: 'web',
    label: '域名镜像入口 / Domain Mirror',
    detail: '当前页面来自域名镜像；公平核验以去中心化内容寻址的 IPFS CID 入口和发布清单为准。 / Domain mirror; fairness verification uses the decentralized content-addressed IPFS CID entry and release manifest.',
    trusted: false,
  };
}

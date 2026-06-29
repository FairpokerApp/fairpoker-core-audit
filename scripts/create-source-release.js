const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release', 'source');
const packageJson = require(path.join(root, 'package.json'));
const releaseMetadataPath = path.join(root, 'src', 'generated', 'releaseMetadata.ts');
const {includedRoots, isExcludedFromRelease, releaseFileContent} = require('./release-source-files');

// Defence-in-depth: even though the included paths are curated, scan every
// shipped text file for anything that looks like a secret and refuse to publish.
// Also block machine-local / secret env files (only .env.production is public).
const forbiddenEnvFiles = new Set([
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
]);

const forbiddenPublicContent = [
  new RegExp('ssh-key-' + '\\d{4}-\\d{2}-\\d{2}\\.key'),
  new RegExp('CLOUDFLARE_' + 'API_TOKEN'),
  new RegExp('CF_' + 'API_TOKEN'),
  new RegExp('PINATA_' + '(?:JWT|API_KEY|API_SECRET)'),
  new RegExp('FILEBASE_' + '(?:ACCESS|SECRET|BUCKET)'),
  new RegExp('BEGIN ' + '(?:OPENSSH|RSA|EC|PRIVATE) KEY'),
];

function readGeneratedFingerprint() {
  if (!fs.existsSync(releaseMetadataPath)) {
    throw new Error('Missing src/generated/releaseMetadata.ts. Run npm run generate:release-metadata first.');
  }
  const text = fs.readFileSync(releaseMetadataPath, 'utf8');
  const match = text.match(/"sourceFingerprint":\s*"(sha256:[a-f0-9]{64})"/);
  if (!match) {
    throw new Error('Could not read sourceFingerprint from release metadata.');
  }
  return match[1];
}

function shouldInclude(filePath) {
  return !isExcludedFromRelease(path.relative(root, filePath));
}

function collectFiles(entry) {
  const fullPath = path.join(root, entry);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return shouldInclude(fullPath) ? [fullPath] : [];
  }

  const result = [];
  for (const name of fs.readdirSync(fullPath)) {
    result.push(...collectFiles(path.join(entry, name)));
  }
  return result;
}

function octal(value, length) {
  const text = value.toString(8);
  return Buffer.from(text.padStart(length - 1, '0') + '\0');
}

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value);
  bytes.copy(header, offset, 0, Math.min(bytes.length, length));
}

function tarHeader(name, size, mode) {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`Tar path is too long for the simple ustar writer: ${name}`);
  }

  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(size, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  Buffer.from('        ').copy(header, 148);
  writeString(header, 156, 1, '0');
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
  return header;
}

// Ship the real package.json: independent rebuilders need its scripts
// (build:repro) and full dependency set to reproduce the Game client CID.
// releaseFileContent applies the shared per-file transform (e.g. stripping the
// mutable GAME_CID from .env.production) so the archive matches the fingerprint.
function archiveContent(file) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  return releaseFileContent(relative, fs.readFileSync(file));
}

function createArchive(files, outputPath) {
  const chunks = [];
  const prefix = 'fair-poker-source';

  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const archivePath = `${prefix}/${relative}`;
    const content = archiveContent(file);
    chunks.push(tarHeader(archivePath, content.length, 0o644));
    chunks.push(content);
    const remainder = content.length % 512;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  const gzip = zlib.gzipSync(tar, { level: 9, mtime: 0 });
  fs.writeFileSync(outputPath, gzip);
}

function assertSafePublicFiles(files) {
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const parts = relative.split('/');
    // Block machine-local / secret env files. .env.production is public on
    // purpose (it only holds the public signaling URL + Game CID) and is needed
    // to reproduce the bundle, so it is allowed through.
    if (parts.some((part) => forbiddenEnvFiles.has(part))) {
      throw new Error(`Refusing to publish forbidden env file in source release: ${relative}`);
    }
    // Belt-and-braces: these must never leak even if added to includedRoots.
    if (/^(?:cloudflare-worker|signal-server|ssh)\//.test(relative)) {
      throw new Error(`Refusing to publish private infrastructure path: ${relative}`);
    }

    const content = fs.readFileSync(file);
    const looksText = !content.includes(0);
    if (!looksText) {
      continue;
    }
    const text = content.toString('utf8');
    for (const pattern of forbiddenPublicContent) {
      if (pattern.test(text)) {
        throw new Error(`Refusing to publish forbidden content pattern ${pattern} in ${relative}`);
      }
    }
  }
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function removeStaleSourceArtifacts(archiveFile) {
  const keep = new Set([archiveFile, `${archiveFile}.sha256`]);
  for (const name of fs.readdirSync(releaseDir)) {
    if (/^fair-poker-source-[a-f0-9]{12}\.tar\.gz(?:\.sha256)?$/.test(name) && !keep.has(name)) {
      fs.rmSync(path.join(releaseDir, name), {force: true});
    }
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function createIndex(manifest) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Fair Poker Source Release</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;margin:0;background:#f6f8f6;color:#1d2b25}
    main{max-width:860px;margin:0 auto;padding:32px 18px}
    h1{font-size:28px;margin:0 0 14px}
    code{overflow-wrap:anywhere;background:#e8eee9;border-radius:4px;padding:2px 5px}
    a{color:#135f46}
    dl{display:grid;gap:10px;margin-top:20px}
    div.row{display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px;border-bottom:1px solid #dfe7e1;padding-bottom:10px}
    dt{font-weight:800;color:#52615b}
    dd{margin:0;overflow-wrap:anywhere}
  </style>
</head>
<body>
  <main>
    <h1>Fair Poker Core Source Release</h1>
    <p>官方域名为 fairpoker.app。此处公开核心发牌、洗牌、加密、解密、transcript 和 verifier 审计源码包、SHA256 和 IPFS CID。文件内容只要被改动一个字，SHA256 和 CID 都会变化。</p>
    <dl>
      <div class="row"><dt>App</dt><dd>${htmlEscape(manifest.appName)} v${htmlEscape(manifest.appVersion)}</dd></div>
      <div class="row"><dt>源码指纹</dt><dd><code>${htmlEscape(manifest.sourceFingerprint)}</code></dd></div>
      <div class="row"><dt>源码包</dt><dd><a href="./${htmlEscape(manifest.archiveFile)}">${htmlEscape(manifest.archiveFile)}</a></dd></div>
      <div class="row"><dt>源码包 SHA256</dt><dd><code>${htmlEscape(manifest.archiveSha256)}</code></dd></div>
      <div class="row"><dt>源码包 CID</dt><dd><code>${htmlEscape(manifest.sourcePackageCid || manifest.ipfsCid || 'not-provided-ipfs-cid')}</code></dd></div>
      <div class="row"><dt>Game client CID</dt><dd><code>${htmlEscape(manifest.gameClientCid || 'pending-game-client-cid')}</code></dd></div>
      <div class="row"><dt>ipfsCid 含义</dt><dd>${htmlEscape(manifest.ipfsCidMeaning || 'Source package CID. This is not the Game client CID.')}</dd></div>
      <div class="row"><dt>IPFS 网关</dt><dd>${manifest.ipfsGatewayUrl ? `<a href="${htmlEscape(manifest.ipfsGatewayUrl)}">${htmlEscape(manifest.ipfsGatewayUrl)}</a>` : 'not-provided-ipfs-url'}</dd></div>
      <div class="row"><dt>发布清单</dt><dd><a href="./release.json">release.json</a></dd></div>
    </dl>
  </main>
</body>
</html>
`;
}

function main() {
  fs.mkdirSync(releaseDir, { recursive: true });
  const sourceFingerprint = readGeneratedFingerprint();
  const short = sourceFingerprint.slice('sha256:'.length, 'sha256:'.length + 12);
  const archiveFile = `fair-poker-source-${short}.tar.gz`;
  const archivePath = path.join(releaseDir, archiveFile);
  const files = includedRoots
    .flatMap(collectFiles)
    .sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));

  assertSafePublicFiles(files);
  createArchive(files, archivePath);
  const archiveSha256 = sha256File(archivePath);
  const ipfsCid = process.env.IPFS_CID || '';
  const gameClientCid = process.env.GAME_CID || '';
  const manifest = {
    appName: 'Fair Poker',
    appVersion: packageJson.version,
    manifestKind: 'fair-poker-source-package-release',
    artifactType: 'source-package',
    createdAt: new Date().toISOString(),
    gameClientCid,
    sourceFingerprint,
    archiveFile,
    archiveUrl: process.env.SOURCE_ARCHIVE_BASE_URL
      ? `${process.env.SOURCE_ARCHIVE_BASE_URL.replace(/\/$/, '')}/${archiveFile}`
      : `not-provided-source-url/${archiveFile}`,
    archiveSha256,
    archiveSha256File: `${archiveFile}.sha256`,
    ipfsCid,
    ipfsCidMeaning: 'Source package CID. This is not the Game client CID.',
    sourcePackageCid: ipfsCid,
    sourcePackageIpfsCid: ipfsCid,
    ipfsGatewayUrl: ipfsCid ? `https://ipfs.io/ipfs/${ipfsCid}` : '',
    canonicalReleaseIdentity: {
      gameClientCid,
      sourcePackageCid: ipfsCid,
      sourceFingerprint,
      archiveSha256,
      releaseManifestUrl: 'https://fairpoker.app/source/release.json',
      aiJsonUrl: 'https://fairpoker.app/ai.json',
    },
    filesCount: files.length,
    archiveRoot: 'fair-poker-source',
    buildCommand: 'npm ci && npm run generate:release-metadata',
    buildCommandMeaning:
      'This package is the COMPLETE buildable client source. The command above re-derives this package\'s sourceFingerprint so reviewers can confirm the archive matches release.json. To independently reproduce the Game client CID byte-for-byte, see reproducibleGameClientBuild below and REPRODUCIBLE_BUILD.md.',
    packageScope: 'full-playable-client-source',
    evidenceScope: 'reproducible playable client + verifiable table fairness source',
    officialDomain: 'fairpoker.app',
    packageContents: [
      'complete React client UI and entry points (src/)',
      'mental-poker dealing and shuffle flow',
      'table state and Texas Holdem settlement logic',
      'signed transcript and hash-chain verifier',
      'static assets the playable client build consumes (public/)',
      'pinned Docker toolchain + reproducible build scripts',
    ],
    reproducibleGameClientBuild: {
      meaning:
        'Anyone can rebuild the playable Game client from this package and confirm the resulting IPFS CID equals the official gameClientCid, proving the client served on IPFS was built from this open source.',
      toolchain: 'Dockerfile.repro (Node pinned by digest) + npm ci (package-lock.json)',
      command: 'scripts/reproducible-game-build.sh <this-archive.tar.gz>',
      sourceDateEpoch: process.env.SOURCE_DATE_EPOCH || 'not-provided-source-date-epoch',
      buildEnv: {
        SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || 'not-provided-source-date-epoch',
        REACT_APP_SOURCE_ARCHIVE_IPFS_CID: ipfsCid || 'pending-source-package-cid',
        REACT_APP_SOURCE_ARCHIVE_SHA256: archiveSha256,
        REACT_APP_SOURCE_ARCHIVE_URL: process.env.SOURCE_ARCHIVE_BASE_URL
          ? `${process.env.SOURCE_ARCHIVE_BASE_URL.replace(/\/$/, '')}/${archiveFile}`
          : `https://fairpoker.app/source/${archiveFile}`,
        REACT_APP_SOURCE_RELEASE_MANIFEST_URL: 'https://fairpoker.app/source/release.json',
      },
      instructions: 'https://fairpoker.app/source/REPRODUCIBLE_BUILD.md',
    },
  };

  fs.writeFileSync(path.join(releaseDir, `${archiveFile}.sha256`), `${archiveSha256.replace('sha256:', '')}  ${archiveFile}\n`);
  fs.writeFileSync(path.join(releaseDir, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(releaseDir, 'index.html'), createIndex(manifest));
  fs.writeFileSync(path.join(releaseDir, 'latest.txt'), `archiveFile=${archiveFile}\narchiveSha256=${archiveSha256}\nsourcePackageCid=${ipfsCid || 'not-provided-ipfs-cid'}\ngameClientCid=${gameClientCid || 'pending-game-client-cid'}\n`);
  removeStaleSourceArtifacts(archiveFile);

  console.log(JSON.stringify(manifest, null, 2));
}

main();

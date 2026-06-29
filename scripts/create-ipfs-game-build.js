const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'build');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, text) {
  fs.writeFileSync(filePath, text);
}

function removePath(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, {recursive: true, force: true});
  }
}

function sanitizeIpfsGameOnlyIndex(targetBuildDir) {
  const indexPath = path.join(targetBuildDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('Game client CID boundary violation: index.html is missing from the IPFS game build.');
  }
  let html = read(indexPath);
  html = html
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      '<meta name="description" content="Fair Poker playable Texas Holdem table client."/>',
    )
    .replace(
      /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/i,
      '<meta name="keywords" content="fair poker, texas holdem, playable table client"/>',
    )
    .replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i, '<meta name="robots" content="noindex,nofollow"/>')
    .replace(/<meta\s+name="googlebot"\s+content="[^"]*"\s*\/?>/i, '<meta name="googlebot" content="noindex,nofollow"/>')
    .replace(/<meta\s+name="bingbot"\s+content="[^"]*"\s*\/?>/i, '<meta name="bingbot" content="noindex,nofollow"/>')
    .replace(/<link\s+rel="canonical"[^>]*>/gi, '')
    .replace(/<link\s+rel="alternate"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:url"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:image"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:image"[^>]*>/gi, '')
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i, '')
    .replace(
      /<noscript>[\s\S]*?<\/noscript>/i,
      '<noscript>JavaScript is required to enter the Fair Poker table client.</noscript>',
    )
    .replace(
      /<div id="root">[\s\S]*?<\/div>\s*<\/body>/i,
      '<div id="root"></div></body>',
    );
  write(indexPath, html);
}

function pruneIpfsGameOnlyBuild(targetBuildDir) {
  for (const name of [
    '_headers',
    'ai.json',
    // ai-index.* aggregate every public page's text and embed a generated
    // timestamp, so they are both non-deterministic and AI/crawler evidence
    // (same class as ai.json / llms.txt). Excluding them keeps the Game client
    // CID reproducible and inside the playable-client boundary.
    'ai-index.html',
    'ai-index.txt',
    'audit',
    'audit-report.html',
    'cookies.html',
    'independent-assurance.html',
    'llms.txt',
    'privacy.html',
    'responsible-play.html',
    'robots.txt',
    'security.html',
    'sitemap.xml',
    'source',
    'terms.html',
    'verify-guide.html',
  ]) {
    removePath(path.join(targetBuildDir, name));
  }
  sanitizeIpfsGameOnlyIndex(targetBuildDir);
}

function assertIpfsGameOnlyBuild(targetBuildDir) {
  const forbiddenPaths = [
    '_headers',
    'ai.json',
    'ai-index.html',
    'ai-index.txt',
    'audit',
    'audit-report.html',
    'cookies.html',
    'independent-assurance.html',
    'llms.txt',
    'privacy.html',
    'responsible-play.html',
    'robots.txt',
    'security.html',
    'sitemap.xml',
    'source',
    'terms.html',
    'verify-guide.html',
  ];
  for (const name of forbiddenPaths) {
    if (fs.existsSync(path.join(targetBuildDir, name))) {
      throw new Error(`Game client CID boundary violation: ${name} is present in the IPFS game build.`);
    }
  }

  const indexHtml = read(path.join(targetBuildDir, 'index.html'));
  const forbiddenIndexPatterns = [
    /fairpoker\.app\/(?:audit|source|ai\.json|llms\.txt|verify-guide|security|independent-assurance)/i,
    /github\.com\/FairpokerApp\/fairpoker-core-audit/i,
    /snyk\.io/i,
    /Official evidence resources/i,
    /public audit pages/i,
    /source release/i,
    /canonical release identity/i,
    /AI-readable/i,
  ];
  for (const pattern of forbiddenIndexPatterns) {
    if (pattern.test(indexHtml)) {
      throw new Error(`Game client CID boundary violation: index.html contains forbidden website/evidence fallback content matching ${pattern}.`);
    }
  }
}

function main() {
  pruneIpfsGameOnlyBuild(buildDir);
  assertIpfsGameOnlyBuild(buildDir);
  console.log(`Prepared IPFS game-only build at ${buildDir}`);
}

main();

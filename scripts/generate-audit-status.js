const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicOutput = path.join(root, 'public', 'audit', 'status.json');
const tsOutput = path.join(root, 'src', 'generated', 'auditStatus.ts');
const packageJson = require(path.join(root, 'package.json'));

function parseArgs(argv) {
  const result = new Set();
  argv.forEach((arg) => {
    if (arg.startsWith('--')) {
      result.add(arg.slice(2));
    }
  });
  return result;
}

function runNpmAudit() {
  try {
    const stdout = childProcess.execFileSync('npm', ['audit', '--json', '--omit=dev'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return {ok: true, data: JSON.parse(stdout)};
  } catch (error) {
    const stdout = error.stdout && error.stdout.toString();
    if (stdout) {
      try {
        return {ok: false, data: JSON.parse(stdout)};
      } catch (_) {
        return {ok: false, error: stdout.slice(0, 500)};
      }
    }
    return {ok: false, error: error.message};
  }
}

function auditSummary(scanAudit) {
  if (!scanAudit) {
    return {
      status: 'continuous',
      evidence: 'Production dependency audit is configured to run during release builds.',
      detail: 'Run npm run audit:status to refresh vulnerability counts.',
      metrics: {},
    };
  }

  const result = runNpmAudit();
  if (!result.data) {
    return {
      status: 'unavailable',
      evidence: 'Production dependency audit attempted but did not return machine-readable results.',
      detail: result.error || 'npm audit unavailable',
      metrics: {},
    };
  }

  const vulnerabilities = result.data.metadata?.vulnerabilities || {};
  const total = Number(vulnerabilities.total || 0);
  const critical = Number(vulnerabilities.critical || 0);
  const high = Number(vulnerabilities.high || 0);
  const moderate = Number(vulnerabilities.moderate || 0);
  const low = Number(vulnerabilities.low || 0);
  const info = Number(vulnerabilities.info || 0);

  return {
    status: total === 0 ? 'active' : 'needs-review',
    evidence: total === 0
      ? 'npm audit found no known production dependency vulnerabilities.'
      : `npm audit found ${total} production dependency finding${total === 1 ? '' : 's'}.`,
    detail: `critical ${critical}, high ${high}, moderate ${moderate}, low ${low}, info ${info}`,
    metrics: {total, critical, high, moderate, low, info},
  };
}

function envOr(name, fallback) {
  return process.env[name] || fallback;
}

// Reproducible builds: src/generated/auditStatus.ts is compiled into the client
// bundle (imported by AuthGate.tsx), so a wall-clock timestamp here would change
// the bundle — and therefore the Game client CID — on every build, making the
// published reproducible-build proof impossible. When SOURCE_DATE_EPOCH (the
// reproducible-builds.org standard, seconds since epoch) is set, derive a stable
// timestamp from it so independent rebuilders get a byte-identical file. Falls
// back to wall clock for local development only.
function deterministicGeneratedAt() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  return new Date().toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scanAudit = args.has('scan') || process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const generatedAt = deterministicGeneratedAt();
  const npmAudit = auditSummary(scanAudit);
  const commit = envOr('GITHUB_SHA', envOr('REACT_APP_SOURCE_COMMIT', envOr('SOURCE_COMMIT', 'source-fingerprint-only')));
  const status = {
    schema: 'fairpoker.audit-status.v1',
    appName: 'Fair Poker',
    appVersion: packageJson.version,
    generatedAt,
    commit,
    reportUrl: '/independent-assurance.html',
    machineReadableUrl: '/audit/status.json',
    summary: {
      headline: 'Public fairness evidence chain',
      statement: 'Fair Poker links public IPFS, SHA256, source fingerprint, signed transcript, and local verifier evidence for the server-not-dealer fairness path.',
      disclosure: 'This status page tracks evidence that is public, downloadable, machine-readable, or locally replayable: release identity, source evidence, and transcript verification.',
    },
    programs: [
      {
        id: 'source-release-evidence',
        name: 'Source release and IPFS evidence',
        category: 'Public reproducibility evidence',
        status: 'active',
        providers: ['SHA256', 'IPFS CID', 'Official source package'],
        evidence: 'Core fairness source archives, release manifests, SHA256 hashes, and IPFS CIDs are published at fairpoker.app/source/ for independent verification.',
        detail: 'Auditors can compare the public source package with the running client fingerprint and release manifest.',
        reportUrl: 'https://fairpoker.app/source/release.json',
      },
      {
        id: 'transcript-verifier',
        name: 'Hand transcript replay verifier',
        category: 'Player-verifiable fairness',
        status: 'active',
        providers: ['Fair Poker verifier CLI', 'Signed transcript hash-chain'],
        evidence: 'Each completed hand can be replayed locally from a downloadable transcript.',
        detail: 'The verifier checks event order, signatures, pot flow, winners, and final hash-chain state.',
        reportUrl: 'https://fairpoker.app/verify-guide.html',
      },
      {
        id: 'live-fairness-audit-overlay',
        name: 'Per-hand four-light fairness audit',
        category: 'Active fairness alerting',
        status: 'active',
        providers: ['handIntegrityAudit', 'FairnessVerificationOverlay'],
        evidence: 'At the end of every hand the browser automatically runs four checks and shows the result on a visual overlay.',
        detail: 'Deck integrity, all-players-shuffled-and-locked, matching record fingerprint, and signature completeness — a pass stamps verified; a warn lights red and offers the evidence for download.',
        reportUrl: 'https://fairpoker.app/security.html',
      },
      {
        id: 'browser-authoritative-state',
        name: 'Browser-authoritative seat and state',
        category: 'Operator power boundary',
        status: 'active',
        providers: ['Local engine truth', 'Worker is dumb relay'],
        evidence: 'During a live hand the local engine is the source of truth; the relay has no protocol path to kick a player, seize chips, or rewrite winners.',
        detail: 'Reconnect replays missed messages by sinceSeq; returning while it is your turn resumes the turn rather than sitting you out.',
        reportUrl: 'https://fairpoker.app/security.html',
      },
      {
        id: 'end-to-end-card-key-sealing',
        name: 'End-to-end sealed per-card decrypt keys',
        category: 'Dealing confidentiality',
        status: 'active',
        providers: ['RSA-OAEP sealing', 'sender/recipient/round/cardOffset binding'],
        evidence: 'Per-card decrypt keys are sealed to the recipient public key and bound to the dealing position; ciphertext redirected elsewhere is rejected.',
        detail: 'The relay sees only ciphertext; per-card keys are kept on-device only for the duration of the current hand (to allow reconnection recovery) and erased when the hand ends.',
        reportUrl: 'https://fairpoker.app/security.html',
      },
    ],
  };

  fs.mkdirSync(path.dirname(publicOutput), {recursive: true});
  fs.writeFileSync(publicOutput, JSON.stringify(status, null, 2) + '\n');

  fs.mkdirSync(path.dirname(tsOutput), {recursive: true});
  fs.writeFileSync(
    tsOutput,
    `// This file is generated by scripts/generate-audit-status.js.\n`
    + `// Do not edit it by hand.\n\n`
    + `export type AuditProgramStatus = 'active' | 'continuous' | 'planned' | 'needs-review' | 'unavailable';\n\n`
    + `export interface AuditProgram {\n`
    + `  id: string;\n`
    + `  name: string;\n`
    + `  category: string;\n`
    + `  status: AuditProgramStatus;\n`
    + `  providers: string[];\n`
    + `  evidence: string;\n`
    + `  detail: string;\n`
    + `  reportUrl: string;\n`
    + `  metrics?: Record<string, number>;\n`
    + `}\n\n`
    + `export interface AuditStatus {\n`
    + `  schema: string;\n`
    + `  appName: string;\n`
    + `  appVersion: string;\n`
    + `  generatedAt: string;\n`
    + `  commit: string;\n`
    + `  reportUrl: string;\n`
    + `  machineReadableUrl: string;\n`
    + `  summary: {headline: string; statement: string; disclosure: string};\n`
    + `  programs: AuditProgram[];\n`
    + `}\n\n`
    + `export const auditStatus: AuditStatus = ${JSON.stringify(status, null, 2)};\n`
  );

  console.log(`Generated ${path.relative(root, publicOutput)} and ${path.relative(root, tsOutput)}`);
}

main();

(function () {
  const identityUrl = '/ai.json';

  function sourceRelease(data) {
    return data && data.currentSourceRelease ? data.currentSourceRelease : {};
  }

  function canonical(data) {
    return data && data.canonicalReleaseIdentity ? data.canonicalReleaseIdentity : {};
  }

  function buildValues(data) {
    const source = sourceRelease(data);
    const root = canonical(data);
    const gameCid = root.gameClientCid || '';
    const sourceCid = source.ipfsCid || '';
    const archiveSha = source.archiveSha256 || '';
    const archiveFile = source.archiveFile || '';
    const archiveUrl = source.archiveUrl || (archiveFile ? `/source/${archiveFile}` : '');
    return {
      gameClientCid: gameCid,
      sourceCid,
      sourceFingerprint: source.sourceFingerprint || '',
      archiveSha256: archiveSha,
      archiveSha256Bare: archiveSha.replace(/^sha256:/, ''),
      sourceArchiveFile: archiveFile,
      sourceArchiveUrl: archiveUrl,
      sourceIpfsUrl: source.ipfsGatewayUrl || (sourceCid ? `https://ipfs.io/ipfs/${sourceCid}` : ''),
      sourceDwebUrl: source.dwebGatewayUrl || (sourceCid ? `https://${sourceCid}.ipfs.dweb.link/` : ''),
      gameIpfsIoUrl: gameCid ? `https://ipfs.io/ipfs/${gameCid}/` : '',
      gameDwebUrl: gameCid ? `https://${gameCid}.ipfs.dweb.link/` : '',
      canonicalAiJsonUrl: 'https://fairpoker.app/ai.json',
      canonicalSourceJsonUrl: 'https://fairpoker.app/source/release.json',
    };
  }

  function fillTextFields(values) {
    document.querySelectorAll('[data-release-field]').forEach(element => {
      const key = element.getAttribute('data-release-field');
      const value = key ? values[key] : '';
      if (value) {
        element.textContent = value;
      }
    });
  }

  function fillHrefFields(values) {
    document.querySelectorAll('[data-release-href]').forEach(element => {
      const key = element.getAttribute('data-release-href');
      const value = key ? values[key] : '';
      if (value) {
        element.setAttribute('href', value);
      }
    });
  }

  function fillValueFields(values) {
    document.querySelectorAll('[data-release-value]').forEach(element => {
      const key = element.getAttribute('data-release-value');
      const value = key ? values[key] : '';
      if (value) {
        element.setAttribute('data-value', value);
      }
    });
  }

  async function loadReleaseIdentity() {
    const response = await fetch(`${identityUrl}?release_identity=${Date.now()}`, {
      cache: 'no-store',
      headers: {'Accept': 'application/json'},
    });
    if (!response.ok) {
      throw new Error(`release identity fetch failed: ${response.status}`);
    }
    return response.json();
  }

  loadReleaseIdentity()
    .then(data => {
      const values = buildValues(data);
      fillTextFields(values);
      fillHrefFields(values);
      fillValueFields(values);
      document.documentElement.dataset.releaseIdentity = 'loaded';
    })
    .catch(error => {
      document.documentElement.dataset.releaseIdentity = 'failed';
      console.error(error);
    });
})();

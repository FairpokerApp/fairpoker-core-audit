(function () {
  var languages = ['zh', 'en', 'ja', 'es', 'fr', 'de'];
  var labels = {
    zh: '中文',
    en: 'English',
    ja: '日本語',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch'
  };
  var pageText = {
    '/verify-guide.html': {
      eyebrow: {
        zh: 'Fair Poker 独立验证',
        en: 'Fair Poker Independent Verification',
        ja: 'Fair Poker 独立検証',
        es: 'Verificación independiente Fair Poker',
        fr: 'Vérification indépendante Fair Poker',
        de: 'Fair Poker Unabhängige Verifizierung'
      },
      title: {
        zh: '独立验证指南',
        en: 'Independent Verification Guide',
        ja: '独立検証ガイド',
        es: 'Guía de verificación independiente',
        fr: 'Guide de vérification indépendante',
        de: 'Anleitung zur unabhängigen Verifizierung'
      },
      intro: {
        zh: '本页说明如何从牌桌下载 transcript，并用公开源码中的 verifier 在本地复验牌局记录。',
        en: 'This page explains how to download a table transcript and replay it locally with the verifier from the public source package.',
        ja: 'このページでは、テーブル transcript をダウンロードし、公開ソースの verifier でローカル検証する方法を説明します。',
        es: 'Esta página explica cómo descargar un transcript de la mesa y reproducirlo localmente con el verificador del código público.',
        fr: 'Cette page explique comment télécharger un transcript de table et le rejouer localement avec le vérificateur du code public.',
        de: 'Diese Seite erklärt, wie ein Tisch-Transcript heruntergeladen und lokal mit dem Verifier aus dem öffentlichen Quellpaket geprüft wird.'
      }
    },
    '/security.html': {
      eyebrow: {
        zh: 'Fair Poker 安全白皮书',
        en: 'Fair Poker Security Whitepaper',
        ja: 'Fair Poker セキュリティ白書',
        es: 'Libro blanco de seguridad Fair Poker',
        fr: 'Livre blanc de sécurité Fair Poker',
        de: 'Fair Poker Sicherheits-Whitepaper'
      },
      title: {
        zh: '安全白皮书',
        en: 'Security Whitepaper',
        ja: 'セキュリティ白書',
        es: 'Libro blanco de seguridad',
        fr: 'Livre blanc de sécurité',
        de: 'Sicherheits-Whitepaper'
      },
      intro: {
        zh: '本页说明 Fair Poker 如何把平台控牌、偷看底牌、篡改牌局和事后改记录放进可验证证据边界。',
        en: 'This page explains how Fair Poker keeps platform card control, hole-card peeking, result tampering, and record rewriting inside a verifiable evidence boundary.',
        ja: 'このページでは、Fair Poker が控牌、ホールカード覗き見、結果改ざん、記録改変を検証可能な証拠境界に入れる方法を説明します。',
        es: 'Esta página explica cómo Fair Poker mantiene control de cartas, lectura de cartas privadas, manipulación de resultados y reescritura de registros dentro de una frontera verificable.',
        fr: 'Cette page explique comment Fair Poker encadre contrôle des cartes, lecture des cartes privées, altération des résultats et réécriture des preuves dans une limite vérifiable.',
        de: 'Diese Seite erklärt, wie Fair Poker Kartenkontrolle, Hole-Card-Einsicht, Ergebnismanipulation und nachträgliche Änderungen in eine überprüfbare Beweisgrenze legt.'
      }
    },
    '/audit-report.html': {
      eyebrow: {
        zh: 'Fair Poker 透明度报告',
        en: 'Fair Poker Transparency Report',
        ja: 'Fair Poker 透明性レポート',
        es: 'Informe de transparencia Fair Poker',
        fr: 'Rapport de transparence Fair Poker',
        de: 'Fair Poker Transparenzbericht'
      },
      title: {
        zh: '透明度报告',
        en: 'Transparency Report',
        ja: '透明性レポート',
        es: 'Informe de transparencia',
        fr: 'Rapport de transparence',
        de: 'Transparenzbericht'
      },
      intro: {
        zh: '本报告面向普通玩家和技术审计者，公开说明 Fair Poker 的 server-not-dealer 牌局模型、IPFS 发布证据、源码指纹、哈希链 transcript 和本地复验方式。',
        en: 'This report explains Fair Poker’s server-not-dealer model, IPFS release evidence, source fingerprints, hash-chain transcripts, and local replay verification.',
        ja: 'このレポートは、server-not-dealer モデル、IPFS 公開証拠、ソース指紋、hash-chain transcript、ローカル検証を説明します。',
        es: 'Este informe explica el modelo server-not-dealer, evidencia IPFS, huellas de código, transcript hash-chain y verificación local.',
        fr: 'Ce rapport explique le modèle server-not-dealer, les preuves IPFS, les empreintes source, les transcripts hash-chain et la vérification locale.',
        de: 'Dieser Bericht erklärt das Server-not-dealer-Modell, IPFS-Veröffentlichungsnachweise, Source-Fingerprints, Hash-Chain-Transcripts und lokale Prüfung.'
      },
      summary: [
        {
          label: { zh: '官方域名', en: 'Official domain', ja: '公式ドメイン', es: 'Dominio oficial', fr: 'Domaine officiel', de: 'Offizielle Domain' },
          value: { zh: 'fairpoker.app', en: 'fairpoker.app', ja: 'fairpoker.app', es: 'fairpoker.app', fr: 'fairpoker.app', de: 'fairpoker.app' }
        },
        {
          label: { zh: '牌局客户端', en: 'Game client', ja: 'ゲームクライアント', es: 'Cliente de juego', fr: 'Client de jeu', de: 'Spielclient' },
          value: { zh: 'IPFS CID 固定', en: 'Pinned by IPFS CID', ja: 'IPFS CID で固定', es: 'Fijado por CID IPFS', fr: 'Fixé par CID IPFS', de: 'Durch IPFS-CID fixiert' }
        },
        {
          label: { zh: '审计证据', en: 'Audit evidence', ja: '監査証拠', es: 'Evidencia de auditoría', fr: 'Preuve d’audit', de: 'Audit-Nachweis' },
          value: { zh: 'SHA256 与牌局记录', en: 'SHA256 and transcript', ja: 'SHA256 と transcript', es: 'SHA256 y transcript', fr: 'SHA256 et transcript', de: 'SHA256 und Transcript' }
        }
      ]
    },
    '/independent-assurance.html': {
      eyebrow: {
        zh: 'Fair Poker 公开证据状态',
        en: 'Fair Poker Public Evidence Status',
        ja: 'Fair Poker 公開証拠ステータス',
        es: 'Estado público de evidencia Fair Poker',
        fr: 'État des preuves publiques Fair Poker',
        de: 'Fair Poker öffentlicher Nachweisstatus'
      },
      title: {
        zh: '公开安全与公平证据状态',
        en: 'Public Security and Fairness Evidence Status',
        ja: '公開セキュリティ・公平性証拠ステータス',
        es: 'Estado público de seguridad y equidad',
        fr: 'État public sécurité et équité',
        de: 'Öffentlicher Sicherheits- und Fairnessstatus'
      },
      intro: {
        zh: 'Fair Poker 把可复验材料公开到浏览器可访问的位置：IPFS 发布 CID、源码 SHA256/source fingerprint、签名 hash-chain transcript 和本地 verifier。',
        en: 'Fair Poker publishes browser-accessible evidence: IPFS CIDs, source SHA256/fingerprint, signed hash-chain transcripts, and local verifier.',
        ja: 'Fair Poker は IPFS CID、ソース SHA256/指紋、署名 hash-chain transcript、ローカル verifier を公開します。',
        es: 'Fair Poker publica evidencia accesible: CID IPFS, SHA256/huella fuente, transcript hash-chain firmado y verificador local.',
        fr: 'Fair Poker publie des preuves accessibles: CID IPFS, SHA256/empreinte source, transcript hash-chain signé et vérificateur local.',
        de: 'Fair Poker veröffentlicht zugängliche Nachweise: IPFS-CIDs, Source-SHA256/Fingerprint, signierte Hash-Chain-Transcripts und lokalen Verifier.'
      },
      summary: [
        {
          label: { zh: '发牌模型', en: 'Dealing model', ja: '配牌モデル', es: 'Modelo de reparto', fr: 'Modèle de distribution', de: 'Austeilmodell' },
          value: { zh: '服务器不发牌', en: 'Server is not the dealer', ja: 'サーバーはディーラーではありません', es: 'El servidor no reparte', fr: 'Le serveur ne distribue pas', de: 'Der Server teilt nicht aus' }
        },
        {
          label: { zh: '发布身份', en: 'Release identity', ja: 'リリース ID', es: 'Identidad de publicación', fr: 'Identité de publication', de: 'Release-Identität' },
          value: { zh: 'CID、SHA256 与指纹', en: 'CID, SHA256, and fingerprint', ja: 'CID、SHA256、指紋', es: 'CID, SHA256 y huella', fr: 'CID, SHA256 et empreinte', de: 'CID, SHA256 und Fingerprint' }
        },
        {
          label: { zh: '机器可读', en: 'Machine-readable', ja: '機械可読', es: 'Legible por máquina', fr: 'Lisible par machine', de: 'Maschinenlesbar' },
          value: { zh: '/audit/status.json', en: '/audit/status.json', ja: '/audit/status.json', es: '/audit/status.json', fr: '/audit/status.json', de: '/audit/status.json' }
        }
      ]
    }
  };
  var common = {
    releaseFacts: {
      zh: '发布事实',
      en: 'Release Facts',
      ja: 'リリース情報',
      es: 'Datos de publicación',
      fr: 'Informations de publication',
      de: 'Release-Fakten'
    },
    officialDomain: {
      zh: '官方域名',
      en: 'Official domain',
      ja: '公式ドメイン',
      es: 'Dominio oficial',
      fr: 'Domaine officiel',
      de: 'Offizielle Domain'
    },
    gameClientCid: {
      zh: '牌局客户端 CID',
      en: 'Game client CID',
      ja: 'ゲームクライアント CID',
      es: 'CID del cliente de juego',
      fr: 'CID du client de jeu',
      de: 'Spielclient-CID'
    },
    sourcePackageCid: {
      zh: '核心源码包 CID',
      en: 'Source package CID',
      ja: 'ソースパッケージ CID',
      es: 'CID del paquete fuente',
      fr: 'CID du paquet source',
      de: 'Quellpaket-CID'
    },
    sourcePackageUrl: {
      zh: '核心源码包 URL',
      en: 'Source package URL',
      ja: 'ソースパッケージ URL',
      es: 'URL del paquete fuente',
      fr: 'URL du paquet source',
      de: 'Quellpaket-URL'
    },
    sourceFingerprint: {
      zh: '源码指纹',
      en: 'Source fingerprint',
      ja: 'ソース指紋',
      es: 'Huella del código fuente',
      fr: 'Empreinte source',
      de: 'Source-Fingerprint'
    },
    archiveSha256: {
      zh: '源码压缩包 SHA256',
      en: 'Archive SHA256',
      ja: 'アーカイブ SHA256',
      es: 'SHA256 del archivo',
      fr: 'SHA256 de l’archive',
      de: 'Archiv-SHA256'
    },
    auditRepository: {
      zh: '证据仓库',
      en: 'Audit repository',
      ja: '監査リポジトリ',
      es: 'Repositorio de auditoría',
      fr: 'Dépôt d’audit',
      de: 'Audit-Repository'
    },
    loadingRelease: {
      zh: '读取 canonical release JSON',
      en: 'Read from canonical release JSON',
      ja: 'canonical release JSON から読み込み',
      es: 'Leer desde canonical release JSON',
      fr: 'Lire depuis le canonical release JSON',
      de: 'Aus canonical release JSON lesen'
    },
    contact: {
      zh: '联系我们',
      en: 'Contact',
      ja: 'お問い合わせ',
      es: 'Contacto',
      fr: 'Contact',
      de: 'Kontakt'
    },
    contactCopy: {
      zh: '问题反馈、Bug 提交、安全线索、授权与合规事务，请联系',
      en: 'For support, bug reports, security leads, licensing, or compliance matters, contact',
      ja: 'サポート、バグ報告、セキュリティ情報、ライセンス、コンプライアンスはお問い合わせください:',
      es: 'Para soporte, bugs, seguridad, licencia o cumplimiento, escribe a',
      fr: 'Pour support, bugs, sécurité, licence ou conformité, contactez',
      de: 'Für Support, Bugmeldungen, Sicherheitshinweise, Lizenz- oder Compliance-Fragen:'
    },
    localizedSummaryTitle: {
      zh: '摘要',
      en: 'Summary',
      ja: '概要',
      es: 'Resumen',
      fr: 'Résumé',
      de: 'Zusammenfassung'
    },
    localizedSummaryCopy: {
      zh: '本页中文原文保留完整证据细节。其它语言显示当前标准多语言摘要，并提供同一组官方证据链接。',
      en: 'The Chinese source page keeps the full evidence details. This localized view provides the same official evidence path and key links in the selected language.',
      ja: '中国語原文は完全な証拠詳細を保持します。この表示では、選択言語で同じ公式証拠パスと主要リンクを示します。',
      es: 'La página fuente en chino conserva todos los detalles. Esta vista localizada muestra la misma ruta de evidencia oficial y enlaces clave en el idioma elegido.',
      fr: 'La page source chinoise conserve tous les détails. Cette vue localisée présente le même parcours de preuve officiel et les liens clés.',
      de: 'Die chinesische Quellseite enthält alle Details. Diese lokalisierte Ansicht zeigt denselben offiziellen Nachweispfad und die wichtigsten Links.'
    },
    officialLinks: {
      zh: '官方证据链接',
      en: 'Official evidence links',
      ja: '公式証拠リンク',
      es: 'Enlaces oficiales de evidencia',
      fr: 'Liens officiels de preuve',
      de: 'Offizielle Nachweislinks'
    }
  };

  function normalizeLanguage(value) {
    var base = String(value || '').toLowerCase().split('-')[0];
    return languages.indexOf(base) >= 0 ? base : undefined;
  }

  function languageFromHash() {
    return normalizeLanguage(window.location.hash && window.location.hash.replace('#', ''));
  }

  function currentLanguage() {
    try {
      return languageFromHash()
        || normalizeLanguage(window.localStorage.getItem('fairpoker:language'))
        || normalizeLanguage(window.navigator.language)
        || 'zh';
    } catch (e) {
      return languageFromHash() || 'zh';
    }
  }

  function text(map, language) {
    return (map && (map[language] || map.en || map.zh)) || '';
  }

  function setText(selector, value) {
    var node = document.querySelector(selector);
    if (node && value) {
      node.textContent = value;
    }
  }

  function normalizedPath() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/index.html';
    if (pageText[path + '.html']) return path + '.html';
    return path;
  }

  function applyLanguage(language) {
    document.documentElement.lang = language;
    document.body.setAttribute('data-language', language);
    try {
      window.localStorage.setItem('fairpoker:language', language);
    } catch (e) {}

    languages.forEach(function (code) {
      var show = code === language;
      document.querySelectorAll('[data-lang="' + code + '"], section#' + code).forEach(function (node) {
        node.hidden = !show;
      });
    });

    document.querySelectorAll('.lang-nav a').forEach(function (link) {
      var code = normalizeLanguage(link.getAttribute('href') && link.getAttribute('href').replace('#', ''));
      if (!code) return;
      link.textContent = labels[code];
      link.setAttribute('aria-current', code === language ? 'true' : 'false');
    });

    var path = normalizedPath();
    var page = pageText[path];
    if (page) {
      var title = text(page.title, language);
      document.title = title ? 'Fair Poker - ' + title : document.title;
      setText('header .eyebrow', text(page.eyebrow, language));
      setText('header h1', title);
      setText('header p', text(page.intro, language));
      if (page.summary) {
        Array.prototype.slice.call(document.querySelectorAll('header .summary div')).forEach(function (item, index) {
          var summary = page.summary[index];
          if (!summary) return;
          var label = item.querySelector('span');
          var value = item.querySelector('strong');
          if (label) label.textContent = text(summary.label, language);
          if (value) value.textContent = text(summary.value, language);
        });
      }
    }

    setText('section[data-release-facts] h2', text(common.releaseFacts, language));
    var facts = Array.prototype.slice.call(document.querySelectorAll('section[data-release-facts] .facts dt'));
    [
      common.officialDomain,
      undefined,
      common.gameClientCid,
      common.sourcePackageCid,
      common.sourcePackageUrl,
      common.sourceFingerprint,
      common.archiveSha256,
      common.auditRepository
    ].forEach(function (label, index) {
      if (label && facts[index]) facts[index].textContent = text(label, language);
    });
    document.querySelectorAll('[data-release-field]').forEach(function (node) {
      if (/Read from canonical release JSON|读取 canonical release JSON|canonical release JSON/.test(node.textContent || '')) {
        node.textContent = text(common.loadingRelease, language);
      }
    });

    var contactSection = document.querySelector('section[data-static-contact]');
    if (contactSection) {
      setText('section[data-static-contact] h2', text(common.contact, language));
      var contactCopy = contactSection.querySelector('p');
      if (contactCopy) {
        contactCopy.innerHTML = text(common.contactCopy, language) + ' <a href="mailto:support@fairpoker.app">support@fairpoker.app</a>.';
      }
    }
    document.dispatchEvent(new CustomEvent('fairpoker:languagechange', { detail: { language: language } }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var style = document.createElement('style');
    style.textContent = '.lang-nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.lang-nav a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border:1px solid #dbe4ef;border-radius:999px;background:#f8fafc;color:#0b6f50;font-size:13px;font-weight:850;text-decoration:none}.lang-nav a[aria-current="true"]{background:#0b6f50;color:#fff;border-color:#0b6f50} [hidden]{display:none!important}';
    document.head.appendChild(style);

    document.querySelectorAll('.lang-nav a').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var code = normalizeLanguage(link.getAttribute('href') && link.getAttribute('href').replace('#', ''));
        if (!code) return;
        event.preventDefault();
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + code);
        } else {
          window.location.hash = code;
        }
        applyLanguage(code);
      });
    });

    window.addEventListener('hashchange', function () {
      var code = languageFromHash();
      if (code) applyLanguage(code);
    });

    applyLanguage(currentLanguage());
  });
})();

import React, {useState} from "react";
import {LanguageSelect, useI18n} from "../lib/i18n";
import type {InAppApp, InAppBrowserInfo} from "../lib/inAppBrowser";
import fairPokerMark from "../assets/fairpoker-mark.svg";

const APP_LABELS: Record<Exclude<InAppApp, 'other'>, string> = {
  telegram: 'Telegram',
  wechat: 'WeChat',
  qq: 'QQ',
  line: 'LINE',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  twitter: 'X',
};

export default function InAppBrowserGuide(props: {info: InAppBrowserInfo; url: string}) {
  const {t} = useI18n();
  const [copied, setCopied] = useState(false);

  const appLabel = props.info.app === 'other' ? t('inappGenericApp') : APP_LABELS[props.info.app];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(props.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2600);
    } catch {
      // Clipboard API is blocked in some webviews — fall back to selecting the
      // address field so the user can copy it by hand.
      const field = document.getElementById('inapp-url-field') as HTMLInputElement | null;
      if (field) {
        field.focus();
        field.select();
      }
    }
  };

  return (
    <div className="auth-screen auth-inapp-screen">
      <header className="auth-topbar" aria-label="Fair Poker">
        <div className="auth-logo">
          <img className="auth-logo-mark" src={fairPokerMark} alt="" aria-hidden="true" />
          <div>
            <strong>Fair Poker</strong>
            <small>{t('brandSubtitle')}</small>
          </div>
        </div>
        <LanguageSelect className="auth-language-select" />
      </header>

      <main className="auth-inapp-main">
        <div className="auth-inapp-card">
          <span className="auth-eyebrow auth-eyebrow-gold">{t('inappEyebrow')}</span>
          <h1 className="auth-inapp-title">{t('inappTitle')}</h1>
          <p className="auth-inapp-why">{t('inappWhy', {app: appLabel})}</p>

          <div className="auth-inapp-method auth-inapp-method-primary">
            <div className="auth-inapp-method-badge">1</div>
            <div className="auth-inapp-method-body">
              <h2>{t('inappMethodAppTitle', {app: appLabel})}</h2>
              <p>{t('inappMethodAppStep')}</p>
            </div>
          </div>

          <div className="auth-inapp-or">{t('inappOr')}</div>

          <div className="auth-inapp-method">
            <div className="auth-inapp-method-badge">2</div>
            <div className="auth-inapp-method-body">
              <h2>{t('inappMethodCopyTitle')}</h2>
              <p>{t('inappCopyHint')}</p>
              <div className="auth-inapp-copyrow">
                <input
                  id="inapp-url-field"
                  className="auth-inapp-url"
                  type="text"
                  value={props.url}
                  readOnly
                  onFocus={event => event.currentTarget.select()}
                  aria-label={t('inappMethodCopyTitle')}
                />
                <button
                  type="button"
                  className={`auth-inapp-copybtn${copied ? ' is-copied' : ''}`}
                  onClick={copyLink}
                >
                  {copied ? t('inappCopiedButton') : t('inappCopyButton')}
                </button>
              </div>
            </div>
          </div>

          <p className="auth-inapp-reassure">{t('inappReassure')}</p>
        </div>
      </main>
    </div>
  );
}

// Detect "restricted" in-app browsers (Telegram, WeChat, etc.) where Fair
// Poker cannot run its in-browser fairness verification layer.
//
// Why this matters: the IPFS service-worker gateway that proves the running
// client is byte-for-byte the published open source needs Service Worker
// support. In-app webviews (Telegram, WeChat, QQ, Line, social apps) either
// strip Service Workers or show the gateway's own "Service Worker Required"
// error before our code can run. Rather than silently dropping into an
// unverifiable mode, we detect these browsers and guide the user to open the
// page in a real system browser (Safari / Chrome), where verification works.

export type InAppApp =
  | 'telegram'
  | 'wechat'
  | 'qq'
  | 'line'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'snapchat'
  | 'twitter'
  | 'other';

export type InAppBrowserInfo = {
  // True when the page is being viewed inside a restricted in-app browser that
  // cannot run the verification layer.
  isInApp: boolean;
  // Best-effort identification of the host app (drives tailored instructions).
  app: InAppApp;
  // Why we flagged it: a known in-app user agent, or a missing Service Worker.
  reason: 'inApp' | 'noServiceWorker' | 'none';
  platform: 'ios' | 'android' | 'other';
};

type Matcher = {app: Exclude<InAppApp, 'other'>; re: RegExp};

// Order matters: more specific signatures first.
const APP_MATCHERS: Matcher[] = [
  {app: 'wechat', re: /MicroMessenger/i},
  {app: 'qq', re: /\bQQ\/|\bMQQBrowser\//i},
  {app: 'telegram', re: /Telegram/i},
  {app: 'line', re: /\bLine\//i},
  {app: 'facebook', re: /FBAN|FBAV|FB_IAB|FBIOS/i},
  {app: 'instagram', re: /Instagram/i},
  {app: 'tiktok', re: /BytedanceWebview|musical_ly|TikTok|Bytedance/i},
  {app: 'snapchat', re: /Snapchat/i},
  {app: 'twitter', re: /Twitter|TwitterAndroid/i},
];

function detectPlatform(ua: string): InAppBrowserInfo['platform'] {
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) {
    return 'android';
  }
  return 'other';
}

// Service Worker support is the technical proxy for "this browser can run the
// verification layer". We only treat its absence as a signal on mobile, because
// every real desktop browser supports it and test/SSR environments (jsdom) lack
// it without being in-app browsers.
function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function detectInAppBrowser(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  hasServiceWorker: boolean = serviceWorkerSupported()
): InAppBrowserInfo {
  const platform = detectPlatform(ua);
  const none: InAppBrowserInfo = {isInApp: false, app: 'other', reason: 'none', platform};

  if (!ua) {
    return none;
  }

  for (const {app, re} of APP_MATCHERS) {
    if (re.test(ua)) {
      return {isInApp: true, app, reason: 'inApp', platform};
    }
  }

  // Unknown webview on a mobile device that cannot run Service Workers: still a
  // restricted browser for our purposes. The mobile guard keeps jsdom/desktop
  // from being misclassified.
  const mobile = platform === 'ios' || platform === 'android';
  if (mobile && !hasServiceWorker) {
    return {isInApp: true, app: 'other', reason: 'noServiceWorker', platform};
  }

  return none;
}

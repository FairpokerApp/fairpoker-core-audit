import {detectInAppBrowser} from "./inAppBrowser";

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0';

describe('detectInAppBrowser', () => {
  test('flags Telegram in-app browser', () => {
    const info = detectInAppBrowser(`${ANDROID} Telegram`, true);
    expect(info.isInApp).toBe(true);
    expect(info.app).toBe('telegram');
    expect(info.reason).toBe('inApp');
    expect(info.platform).toBe('android');
  });

  test('flags WeChat (MicroMessenger)', () => {
    const info = detectInAppBrowser(`${IOS} MicroMessenger/8.0.49`, true);
    expect(info.isInApp).toBe(true);
    expect(info.app).toBe('wechat');
    expect(info.platform).toBe('ios');
  });

  test('flags Facebook / Instagram webviews', () => {
    expect(detectInAppBrowser(`${IOS} [FBAN/FBIOS]`, true).app).toBe('facebook');
    expect(detectInAppBrowser(`${IOS} Instagram 300.0`, true).app).toBe('instagram');
  });

  test('flags an unknown mobile webview with no Service Worker', () => {
    const info = detectInAppBrowser(`${IOS} SomeWeirdWebview/1.0`, false);
    expect(info.isInApp).toBe(true);
    expect(info.app).toBe('other');
    expect(info.reason).toBe('noServiceWorker');
  });

  test('does NOT flag a normal mobile Safari with Service Worker', () => {
    const info = detectInAppBrowser(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1`, true);
    expect(info.isInApp).toBe(false);
  });

  test('does NOT flag a normal desktop Chrome', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    expect(detectInAppBrowser(ua, true).isInApp).toBe(false);
  });

  test('does NOT flag a desktop/test env that lacks Service Worker (jsdom guard)', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) jsdom/22.0';
    expect(detectInAppBrowser(ua, false).isInApp).toBe(false);
  });

  test('returns not-in-app for an empty user agent', () => {
    expect(detectInAppBrowser('', false).isInApp).toBe(false);
  });
});

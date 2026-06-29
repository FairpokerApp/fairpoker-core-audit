import React from "react";

// Top-level safety net. React unmounts the whole tree (white screen of death) the
// moment any render/lifecycle throws an uncaught error. This boundary catches it,
// shows a friendly Chinese fallback, and auto-reloads to recover — turning a dead
// blank page into a self-healing reload. A loop guard makes sure we never reload
// forever if the crash reproduces immediately on load.

const RELOAD_GUARD_KEY = 'fairpoker:error-boundary-reload-at';
// If we crashed again within this window of the last auto-reload, assume the crash
// reproduces on load and stop auto-reloading — offer a manual retry button instead.
const RELOAD_LOOP_WINDOW_MS = 12_000;
// Let the fallback paint for a beat before navigating away.
const AUTO_RELOAD_DELAY_MS = 1200;

type Props = { children: React.ReactNode };
type State = { hasError: boolean; willReload: boolean };

function reloadedRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (!raw) {
      return false;
    }
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < RELOAD_LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable — best effort */
  }
}

function safeReload(): void {
  try {
    window.location.reload();
  } catch {
    /* jsdom / no-navigation environment — no-op */
  }
}

// Inline styles so the fallback renders correctly even if a CSS bundle failed to
// load (the very failure that might have crashed the app).
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'radial-gradient(circle at 50% 30%, #0f3d2e 0%, #07211a 60%, #04140f 100%)',
  color: '#f6f4ec',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  zIndex: 2147483647,
};

const cardStyle: React.CSSProperties = {
  maxWidth: '360px',
  width: '100%',
  textAlign: 'center',
  background: 'rgba(7, 33, 26, 0.72)',
  border: '1px solid rgba(212, 175, 55, 0.35)',
  borderRadius: '18px',
  padding: '32px 28px',
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
};

const markStyle: React.CSSProperties = {
  fontSize: '34px',
  color: '#d4af37',
  lineHeight: 1,
  marginBottom: '12px',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '22px',
  fontWeight: 600,
};

const textStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: '15px',
  opacity: 0.85,
};

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: '999px',
  padding: '12px 28px',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  color: '#07211a',
  background: 'linear-gradient(135deg, #f0d27a 0%, #d4af37 100%)',
};

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, willReload: false };

  static getDerivedStateFromError(): State {
    return { hasError: true, willReload: !reloadedRecently() };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Keep a console record so we can still diagnose what went wrong.
    console.error('[FairPoker] 界面发生未捕获错误，已由兜底拦截：', error, info);
    if (this.state.willReload) {
      markReloaded();
      window.setTimeout(safeReload, AUTO_RELOAD_DELAY_MS);
    }
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div style={overlayStyle} role="alert" data-testid="error-boundary-fallback">
        <div style={cardStyle}>
          <div style={markStyle} aria-hidden="true">&#9824;</div>
          <h1 style={titleStyle}>出错了</h1>
          <p style={textStyle}>
            {this.state.willReload ? '正在重新加载…' : '请点击下方按钮刷新重试。'}
          </p>
          <button type="button" style={buttonStyle} onClick={safeReload}>
            刷新重试
          </button>
        </div>
      </div>
    );
  }
}

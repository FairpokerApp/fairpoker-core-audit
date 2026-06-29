import React, {useEffect, useReducer} from "react";
import {ensureSetupReady, isSetupReady} from "../lib/setup";

// Renders the table only once the async setup singleton (TexasHoldem) actually
// exists. On the happy path AuthGate has already awaited setup, so this is a
// pass-through. Its real job is defense-in-depth: the table's hooks read
// TexasHoldem.getStateSnapshot()/.members/.listener directly, and if that
// singleton is ever read while undefined the whole tree crashes into a white
// screen. The one place that happens today is a dev hot-reload re-evaluating the
// setup module (resetting TexasHoldem to undefined) while React keeps the old
// "ready" flag. Here we show a loading screen and re-run setup instead.
//
// `isSetupReady()` is read live every render (not cached in React state) on
// purpose: a hot-reload resets the module value but preserves component state, so
// a cached flag would go stale and still crash.

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
};

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  letterSpacing: '0.04em',
  opacity: 0.85,
};

export default function SetupReadyGate({children}: {children: React.ReactNode}) {
  const ready = isSetupReady();
  const [, retick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (ready) {
      return;
    }
    let cancelled = false;
    ensureSetupReady()
      .then(() => {
        if (!cancelled) {
          retick();
        }
      })
      .catch(() => {
        // AuthGate owns surfacing setup failures; here we only avoid crashing.
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!ready) {
    return (
      <div style={overlayStyle} role="status" aria-live="polite" data-testid="setup-loading">
        <p style={textStyle}>正在加载牌桌…</p>
      </div>
    );
  }

  return <>{children}</>;
}

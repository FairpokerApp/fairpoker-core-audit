import React from "react";
import {render, screen} from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Boom(): React.ReactElement {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // React logs caught render errors to console.error; silence + inspect it.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.clear();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child-ok">桌面正常</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child-ok')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
  });

  test('catches a child crash and shows the fallback instead of white-screening', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // Fallback is shown — the tree was NOT unmounted into a blank page.
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText('出错了')).toBeInTheDocument();
    // First crash (no recent reload) => auto-reload path.
    expect(screen.getByText('正在重新加载…')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '刷新重试'})).toBeInTheDocument();
    // The crash was recorded for diagnosis.
    expect(consoleError).toHaveBeenCalled();
  });

  test('offers manual retry (no auto-reload) when it just reloaded', () => {
    // Simulate a reload that happened a moment ago: a second crash within the
    // loop window must not auto-reload (which would loop forever).
    sessionStorage.setItem('fairpoker:error-boundary-reload-at', String(Date.now()));

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText('请点击下方按钮刷新重试。')).toBeInTheDocument();
    expect(screen.queryByText('正在重新加载…')).not.toBeInTheDocument();
  });
});

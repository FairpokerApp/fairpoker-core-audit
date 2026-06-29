import {render, screen, waitFor} from "@testing-library/react";
import React from "react";
import App from "./App";

jest.mock('./lib/setup');

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('http://127.0.0.1:3101/?entry=game'),
  });
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ok: true}),
  } as Response);
  localStorage.setItem('fairpoker:language', 'zh');
  localStorage.removeItem('fairpoker:joinedTables');
  localStorage.setItem('fairpoker:authSession', JSON.stringify({
    kind: 'registered',
    userId: 'test-user',
    username: 'Alice',
    token: 'test-token',
    expiresAt: Date.now() + 60_000,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('rendering does not crash', async () => {
  render(<App />);
  expect(await screen.findByTestId('game-lobby')).toBeInTheDocument();
});

test('opens the table when a table id is present', async () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('http://127.0.0.1:3101/?entry=game&tableId=table-test'),
  });

  render(<App />);
  expect(await screen.findByTestId('table')).toBeInTheDocument();
});

test('shows fairness proof on the official landing page', async () => {
  localStorage.removeItem('fairpoker:authSession');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://fairpoker.app/'),
  });
  render(<App />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  expect(screen.getAllByText('Fair Poker').length).toBeGreaterThan(0);
  expect(screen.getByText(/fairpoker.app 承载官网/)).toBeInTheDocument();
  expect(screen.getByText('代码不藏在黑箱里')).toBeInTheDocument();
  expect(screen.getByText('官网归官网，代码归 CID')).toBeInTheDocument();
  expect(screen.getByText('牌史不进中心化黑箱')).toBeInTheDocument();
  expect(screen.getByText('去中心化访问')).toBeInTheDocument();
  expect(screen.getByText('多网关可访问')).toBeInTheDocument();
  expect(screen.getAllByText('进入牌桌').length).toBeGreaterThan(0);
  expect(screen.queryByText('账号进桌')).not.toBeInTheDocument();
  expect(screen.queryByText(/老账号直接进入/)).not.toBeInTheDocument();
});

test('homepage still renders when stored language cannot be read', async () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://fairpoker.app/'),
  });
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'fairpoker:language') {
      throw new Error('storage unavailable');
    }
    return null;
  });

  render(<App />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  expect(screen.getAllByText('Fair Poker').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', {name: /进入牌桌|Enter table/}).length).toBeGreaterThan(0);
});

test('shows the merged account form on the game client entry page', async () => {
  localStorage.removeItem('fairpoker:authSession');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('https://bafyexample.ipfs.inbrowser.link/?tableId=table-test'),
  });

  render(<App />);

  expect(await screen.findByText('进入牌桌')).toBeInTheDocument();
  expect(screen.getByText(/新账号自动开通，首批永久免费/)).toBeInTheDocument();
  expect(screen.queryByText(/换浏览器回来，用同一账号继续/)).not.toBeInTheDocument();
  expect(screen.queryByText('可找回牌局')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('3-24 位')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('至少 8 位')).toBeInTheDocument();
});

test('clears a stale local session when the worker rejects it', async () => {
  (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
    if (String(url).includes('/auth/me')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({error: '未登录或会话已过期。'}),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ok: true}),
    } as Response);
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL('http://127.0.0.1:3101/?entry=game&tableId=table-test'),
  });

  render(<App />);

  expect(await screen.findByText('进入牌桌')).toBeInTheDocument();
  expect(screen.getByText('登录已过期，请重新输入账号密码。')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('3-24 位')).toBeInTheDocument();
  expect(screen.queryByTestId('table')).not.toBeInTheDocument();
});

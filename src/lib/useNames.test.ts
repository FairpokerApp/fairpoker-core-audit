import {act, renderHook, waitFor} from "@testing-library/react";
import EventEmitter from "eventemitter3";
import {ChatRoomEvents} from "./ChatRoom";
import useNames, {ChatRoomLike} from "./useNames";
import {RelayPeerProfile} from "./CloudflareRelayTransport";

function profile(peerId: string, accountUsername: string): RelayPeerProfile {
  return {
    peerId,
    accountId: `account-${peerId}`,
    accountUsername,
    connectedAt: 1,
    source: 'test',
    browser: 'Safari',
    os: 'macOS',
    device: 'desktop',
    platform: 'MacIntel',
    language: 'zh-CN',
    timezone: 'Asia/Tokyo',
    country: 'JP',
    screenBucket: '1900x1100',
    hardware: '8c-unknownm',
    ipSegment: '182.210.14.*',
    networkFingerprint: `net-${peerId}`,
    ipConfidence: 'high',
    clientFingerprint: `env-${peerId}`,
  };
}

describe('useNames', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('names are updated', async () => {
    const listener = new EventEmitter<ChatRoomEvents>();
    const mockChatRoom: ChatRoomLike = {
      listener,
    };
    const { result } = renderHook(() => useNames(mockChatRoom));

    act(() => {
      listener.emit('name', 'Alice', 'player1')
      listener.emit('name', 'Bob', 'player2');
    });

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });

    const names = result.current;
    expect(names.get('player1')).toBe('Alice');
    expect(names.get('player2')).toBe('Bob');
  });

  test('worker account usernames fill missing names and stay consistent', async () => {
    const listener = new EventEmitter<ChatRoomEvents>();
    const mockChatRoom: ChatRoomLike = {
      listener,
    };
    const { result } = renderHook(() => useNames(mockChatRoom));

    act(() => {
      listener.emit('name', 'Temporary Alice', 'player1');
      window.dispatchEvent(new CustomEvent('fairpoker:peer-profiles', {
        detail: {
          profiles: [
            profile('player1', 'Alice'),
            profile('player2', 'Bob'),
          ],
        },
      }));
    });

    await waitFor(() => {
      expect(result.current.get('player1')).toBe('Alice');
      expect(result.current.get('player2')).toBe('Bob');
    });
  });
});

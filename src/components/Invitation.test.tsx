import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import Invitation, {buildRoomLink} from "./Invitation";

describe("Invitation", () => {
  let writeText = jest.fn();

  beforeEach(() => {
    writeText = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });
    writeText.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    writeText.mockReset();
  })

  test('rendering does not crash', () => {
    render(<Invitation hostPlayerId="player"/>);
  });

  test('copy the link', async () => {
    render(<Invitation hostPlayerId="player"/>);

    const copyButton = screen.getByTestId('copy-link-button');
    expect(copyButton).toBeVisible();

    expect(copyButton).toHaveTextContent('复制');

    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalled();

    await waitFor(() => {
      expect(copyButton).toHaveTextContent('已复制牌局');
    });

    await waitFor(() => {
      expect(copyButton).toHaveTextContent('复制');
    }, {
      timeout: 5500,
    });
  }, 6000);

  test('builds official entry room links from an IPFS gateway page', () => {
    expect(buildRoomLink(
      'host-player',
      'https://ipfs.io/ipfs/QmRxJQFpbB4g5jk6ahSxUrqBbogYjVd5eJZb72ym1PgSTq/',
    )).toBe('https://fairpoker.app/?gameRoomId=host-player');
  });

  test('uses the official entry and replaces an existing room id', () => {
    expect(buildRoomLink(
      'new-host',
      'https://ipfs.io/ipfs/QmRxJQFpbB4g5jk6ahSxUrqBbogYjVd5eJZb72ym1PgSTq/?gameRoomId=old-host',
    )).toBe('https://fairpoker.app/?gameRoomId=new-host');
  });

  test('falls back to the current room id when the local host id is not provided', () => {
    expect(buildRoomLink(
      '',
      'https://bafyexample.ipfs.dweb.link/?gameRoomId=current-host',
    )).toBe('https://fairpoker.app/?gameRoomId=current-host');
  });

  test('includes a table id so repeated games by the same host are isolated', () => {
    expect(buildRoomLink(
      'host-player',
      'table-abc',
      'https://ipfs.io/ipfs/QmRxJQFpbB4g5jk6ahSxUrqBbogYjVd5eJZb72ym1PgSTq/',
    )).toBe('https://fairpoker.app/?gameRoomId=host-player&tableId=table-abc');
  });

  test('uses the local game entry when debugging locally', () => {
    expect(buildRoomLink(
      'host-player',
      'http://127.0.0.1:3101/?entry=game',
    )).toBe('http://127.0.0.1:3101/?entry=game&gameRoomId=host-player');
  });

  test('uses the latest local table id when debugging locally', () => {
    expect(buildRoomLink(
      'host-player',
      'table-local-next',
      'http://127.0.0.1:3101/?entry=game&tableId=table-local-old',
    )).toBe('http://127.0.0.1:3101/?entry=game&gameRoomId=host-player&tableId=table-local-next');
  });
});

import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import SetupReadyGate from "./SetupReadyGate";

// Togglable setup readiness so we can exercise both the ready and not-ready paths.
// (Prefixed `mock*` so jest.mock's hoisting allows referencing it in the factory.)
let mockSetupReady = true;
const mockEnsureSetupReady = jest.fn(() => Promise.resolve({}));

jest.mock('../lib/setup', () => ({
  isSetupReady: () => mockSetupReady,
  ensureSetupReady: () => mockEnsureSetupReady(),
}));

// A child that would crash exactly like the real table does when TexasHoldem is
// undefined — proving the gate prevents it from ever mounting in that state.
function TableLike(): React.ReactElement {
  throw new Error('TexasHoldem is undefined — should never render while not ready');
}

describe('SetupReadyGate', () => {
  beforeEach(() => {
    // CRA sets resetMocks:true, which wipes the jest.fn implementation before each
    // test — so (re)install it here rather than relying on the constructor.
    mockSetupReady = true;
    mockEnsureSetupReady.mockReset();
    mockEnsureSetupReady.mockResolvedValue({});
  });

  test('renders children when setup is ready', () => {
    render(
      <SetupReadyGate>
        <div data-testid="table-child">牌桌</div>
      </SetupReadyGate>,
    );
    expect(screen.getByTestId('table-child')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-loading')).not.toBeInTheDocument();
  });

  test('shows loading (not a white screen / crash) when setup is not ready', () => {
    mockSetupReady = false;
    // Stay pending so this test owns no post-render state update (no act warning);
    // the self-heal-to-children path is covered by the next test.
    mockEnsureSetupReady.mockReturnValue(new Promise(() => {}));
    render(
      <SetupReadyGate>
        <TableLike />
      </SetupReadyGate>,
    );
    // The crashing child was never mounted; we see the loading screen instead.
    expect(screen.getByTestId('setup-loading')).toBeInTheDocument();
    expect(screen.getByText('正在加载牌桌…')).toBeInTheDocument();
    // It tries to re-run setup to self-heal.
    expect(mockEnsureSetupReady).toHaveBeenCalled();
  });

  test('reveals children once setup finishes after starting not-ready', async () => {
    mockSetupReady = false;
    mockEnsureSetupReady.mockImplementation(() => {
      // Setup completes: flip the live module value before resolving.
      mockSetupReady = true;
      return Promise.resolve({});
    });

    render(
      <SetupReadyGate>
        <div data-testid="table-child">牌桌</div>
      </SetupReadyGate>,
    );

    expect(screen.getByTestId('setup-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('table-child')).toBeInTheDocument());
    expect(screen.queryByTestId('setup-loading')).not.toBeInTheDocument();
  });
});

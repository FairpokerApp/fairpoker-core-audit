import TexasHoldemGameTable from "./components/TexasHoldemGameTable";
import React from "react";
import AuthGate from "./components/AuthGate";
import {LanguageProvider} from "./lib/i18n";
import TexasHoldemUiPreview from "./components/TexasHoldemUiPreview";
import GameLobby from "./components/GameLobby";
import ErrorBoundary from "./components/ErrorBoundary";
import SetupReadyGate from "./components/SetupReadyGate";

const OFFICIAL_HOSTS = new Set(['fairpoker.app', 'www.fairpoker.app']);

function isOfficialHost() {
  return OFFICIAL_HOSTS.has(window.location.hostname);
}

function hasTableEntry() {
  const params = new URLSearchParams(window.location.search);
  return params.has('gameRoomId') || params.has('tableId');
}

export default function App() {
  const uiPreview = process.env.NODE_ENV === 'development'
    && new URLSearchParams(window.location.search).has('uiPreview');
  // Dev-only: preview the official landing page on localhost (it normally only
  // renders on the fairpoker.app host). No effect in production builds.
  const previewLanding = process.env.NODE_ENV === 'development'
    && new URLSearchParams(window.location.search).has('previewLanding');
  const showGameLobby = !uiPreview && !previewLanding && !hasTableEntry() && !isOfficialHost();

  return (
    <ErrorBoundary>
      <LanguageProvider>
        {uiPreview ? (
          <TexasHoldemUiPreview />
        ) : showGameLobby ? (
          <GameLobby />
        ) : (
          <AuthGate>
            <SetupReadyGate>
              <TexasHoldemGameTable/>
            </SetupReadyGate>
          </AuthGate>
        )}
      </LanguageProvider>
    </ErrorBoundary>
  );
}

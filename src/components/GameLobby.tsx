import React, {useEffect, useMemo, useState} from "react";
import {LanguageSelect, useI18n} from "../lib/i18n";
import fairPokerMark from "../assets/fairpoker-mark.svg";
import {
  buildCreateTableUrl,
  buildJoinedTableUrl,
  JoinedTableRecord,
  readJoinedTables,
  removeJoinedTable,
} from "../lib/tableLobby";

const OFFICIAL_HOME_URL = 'https://fairpoker.app/';

function shortTableId(tableId: string) {
  return tableId.length > 16 ? `${tableId.slice(0, 10)}...${tableId.slice(-6)}` : tableId;
}

function formatTableTime(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

function tableTitle(record: JoinedTableRecord) {
  return record.title || `牌桌 ${record.tableId.slice(-6)}`;
}

export default function GameLobby() {
  const {t} = useI18n();
  const [tables, setTables] = useState<JoinedTableRecord[]>(() => readJoinedTables());

  useEffect(() => {
    const refresh = () => setTables(readJoinedTables());
    window.addEventListener('storage', refresh);
    window.addEventListener('fairpoker:joined-tables-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('fairpoker:joined-tables-changed', refresh);
    };
  }, []);

  const lastTable = tables[0];
  const heroCards = useMemo(() => ['sa', 'hk', 'dq', 'cj'], []);

  const createTable = () => {
    window.location.assign(buildCreateTableUrl());
  };

  const enterTable = (record: JoinedTableRecord, spectator = false) => {
    window.location.assign(buildJoinedTableUrl(record, window.location.href, {spectator}));
  };

  return (
    <main className="game-lobby" data-testid="game-lobby">
      <header className="game-lobby-topbar">
        <div className="game-lobby-brand">
          <img src={fairPokerMark} alt="" aria-hidden="true" />
          <div>
            <strong>Fair Poker</strong>
            <span>{t('gameLobbySubtitle')}</span>
          </div>
        </div>
        <div className="game-lobby-topbar-actions">
          <a
            className="game-lobby-home-link"
            href={OFFICIAL_HOME_URL}
            data-testid="back-to-official-home"
          >
            {t('backToOfficialHome')}
          </a>
          <LanguageSelect className="game-lobby-language" />
        </div>
      </header>

      <section className="game-lobby-shell">
        <div className="game-lobby-hero">
          <div className="game-lobby-copy">
            <span>{t('gameLobbyKicker')}</span>
            <h1>{t('gameLobbyTitle')}</h1>
            <p>{t('gameLobbyCopy')}</p>
            <div className="game-lobby-actions">
              <button type="button" className="game-lobby-primary" onClick={createTable} data-testid="create-table-button">
                {t('createNewTable')}
              </button>
              {lastTable && (
                <button type="button" className="game-lobby-secondary" onClick={() => enterTable(lastTable)} data-testid="resume-last-table-button">
                  {t('resumeLastTable')}
                </button>
              )}
            </div>
          </div>

          <div className="game-lobby-table-visual" aria-hidden="true">
            <div className="game-lobby-felt">
              <div className="game-lobby-card-row">
                {heroCards.map(card => (
                  <img src={`${process.env.PUBLIC_URL}/cards/${card}.svg`} alt="" key={card} />
                ))}
              </div>
              <div className="game-lobby-chip-line">
                <img src={`${process.env.PUBLIC_URL}/chip.svg`} alt="" />
                <span>{t('playChipsOnly')}</span>
              </div>
            </div>
          </div>
        </div>

        <section className="game-lobby-table-list" aria-label={t('joinedTables')} data-testid="joined-table-list">
          <div className="game-lobby-section-head">
            <div>
              <span>{t('joinedTablesKicker')}</span>
              <h2>{t('joinedTables')}</h2>
            </div>
            <strong>{t('joinedTablesCount', {count: tables.length})}</strong>
          </div>

          {tables.length === 0 ? (
            <div className="game-lobby-empty">
              <strong>{t('noJoinedTablesTitle')}</strong>
              <p>{t('noJoinedTablesCopy')}</p>
              <button type="button" onClick={createTable}>{t('createNewTable')}</button>
            </div>
          ) : (
            <div className="game-lobby-table-grid">
              {tables.map(record => (
                <article className="game-lobby-table-card" key={record.tableId}>
                  <div className="game-lobby-table-card-main">
                    <span>{t(record.hostId ? 'joinedTableGuest' : 'joinedTableHost')}</span>
                    <h3>{tableTitle(record)}</h3>
                    <dl>
                      <div>
                        <dt>{t('tableId')}</dt>
                        <dd>{shortTableId(record.tableId)}</dd>
                      </div>
                      <div>
                        <dt>{t('lastVisited')}</dt>
                        <dd>{formatTableTime(record.lastVisitedAt)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="game-lobby-table-card-actions">
                    <button type="button" onClick={() => enterTable(record)}>
                      {t('enterJoinedTable')}
                    </button>
                    <button type="button" className="game-lobby-watch" onClick={() => enterTable(record, true)}>
                      {t('watchJoinedTable')}
                    </button>
                    <button type="button" className="game-lobby-remove" onClick={() => removeJoinedTable(record.tableId)}>
                      {t('removeJoinedTable')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

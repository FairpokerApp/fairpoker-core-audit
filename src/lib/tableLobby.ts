export type JoinedTableRecord = {
  tableId: string;
  hostId?: string;
  localPlayerId?: string;
  title?: string;
  joinedAt: number;
  lastVisitedAt: number;
};

const JOINED_TABLES_KEY = 'fairpoker:joinedTables';
const MAX_JOINED_TABLES = 12;

function createTableId() {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `table-${random}`;
}

function withGameEntry(currentHref: string) {
  const url = new URL(currentHref);
  url.searchParams.set('entry', 'game');
  return url;
}

export function buildGameLobbyUrl(currentHref = window.location.href) {
  const url = withGameEntry(currentHref);
  url.searchParams.delete('gameRoomId');
  url.searchParams.delete('tableId');
  url.searchParams.delete('spectator');
  return url.toString();
}

export function buildCreateTableUrl(currentHref = window.location.href) {
  const url = withGameEntry(currentHref);
  url.searchParams.delete('gameRoomId');
  url.searchParams.delete('spectator');
  url.searchParams.set('tableId', createTableId());
  return url.toString();
}

export function buildJoinedTableUrl(record: JoinedTableRecord, currentHref = window.location.href, options?: {spectator?: boolean}) {
  const url = withGameEntry(currentHref);
  url.searchParams.set('tableId', record.tableId);
  if (record.hostId) {
    url.searchParams.set('gameRoomId', record.hostId);
  } else {
    url.searchParams.delete('gameRoomId');
  }
  if (options?.spectator) {
    url.searchParams.set('spectator', '1');
  } else {
    url.searchParams.delete('spectator');
  }
  return url.toString();
}

function isJoinedTableRecord(value: unknown): value is JoinedTableRecord {
  const record = value as Partial<JoinedTableRecord> | undefined;
  return Boolean(
    record
    && typeof record.tableId === 'string'
    && record.tableId.length > 0
    && typeof record.joinedAt === 'number'
    && typeof record.lastVisitedAt === 'number'
  );
}

export function readJoinedTables(): JoinedTableRecord[] {
  try {
    const raw = window.localStorage.getItem(JOINED_TABLES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isJoinedTableRecord)
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
      .slice(0, MAX_JOINED_TABLES);
  } catch {
    return [];
  }
}

function writeJoinedTables(records: JoinedTableRecord[]) {
  try {
    window.localStorage.setItem(JOINED_TABLES_KEY, JSON.stringify(records.slice(0, MAX_JOINED_TABLES)));
  } catch {
    // The game can still run if the browser blocks local storage.
  }
}

export function upsertJoinedTable(update: {
  tableId: string;
  hostId?: string;
  localPlayerId?: string;
  title?: string;
}) {
  const now = Date.now();
  const existing = readJoinedTables();
  const current = existing.find(record => record.tableId === update.tableId);
  const nextRecord: JoinedTableRecord = {
    tableId: update.tableId,
    hostId: update.hostId ?? current?.hostId,
    localPlayerId: update.localPlayerId ?? current?.localPlayerId,
    title: update.title ?? current?.title,
    joinedAt: current?.joinedAt ?? now,
    lastVisitedAt: now,
  };
  writeJoinedTables([
    nextRecord,
    ...existing.filter(record => record.tableId !== update.tableId),
  ]);
  window.dispatchEvent(new Event('fairpoker:joined-tables-changed'));
}

export function removeJoinedTable(tableId: string) {
  writeJoinedTables(readJoinedTables().filter(record => record.tableId !== tableId));
  window.dispatchEvent(new Event('fairpoker:joined-tables-changed'));
}

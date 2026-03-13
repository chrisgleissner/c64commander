import type {
  PlaylistItemRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistQueryRow,
  TrackRecord,
} from "./types";

export type PersistedPlaylistQueryRow = {
  playlistItem: PlaylistItemRecord;
  track: TrackRecord;
  searchText: string;
};

export type PersistedPlaylistQueryIndex = {
  rowsById: Record<string, PersistedPlaylistQueryRow>;
  orderBy: {
    "playlist-position": string[];
    title: string[];
    path: string[];
  };
  idsByCategory: Record<string, string[]>;
  idsBySearchGram: Record<string, string[]>;
};

const normalizeQuery = (value?: string) => value?.trim().toLowerCase() ?? "";

const buildRowSearchText = (row: PlaylistQueryRow) => {
  const parts = [
    row.track.title,
    row.track.author ?? "",
    row.track.released ?? "",
    row.track.path,
    row.track.sourceLocator,
    row.track.category ?? "",
  ];
  return parts.join(" ").toLowerCase();
};

const buildSearchGrams = (text: string) => {
  if (text.length < 3) return [];
  const grams = new Set<string>();
  for (let index = 0; index <= text.length - 3; index += 1) {
    grams.add(text.slice(index, index + 3));
  }
  return [...grams];
};

const sortRows = (rows: PersistedPlaylistQueryRow[], sort: PlaylistQueryOptions["sort"]) => {
  const next = [...rows];
  next.sort((left, right) => {
    if (sort === "title") {
      const titleDiff = left.track.title.localeCompare(right.track.title);
      if (titleDiff !== 0) return titleDiff;
    }
    if (sort === "path") {
      const pathDiff = left.track.path.localeCompare(right.track.path);
      if (pathDiff !== 0) return pathDiff;
    }
    return left.playlistItem.sortKey.localeCompare(right.playlistItem.sortKey);
  });
  return next;
};

export const buildPlaylistQueryIndex = (
  playlistItems: PlaylistItemRecord[],
  tracksById: Record<string, TrackRecord>,
): PersistedPlaylistQueryIndex => {
  const rows = playlistItems
    .map((playlistItem) => {
      const track = tracksById[playlistItem.trackId];
      if (!track) return null;
      const row: PlaylistQueryRow = { playlistItem, track };
      return {
        playlistItem,
        track,
        searchText: buildRowSearchText(row),
      };
    })
    .filter((row): row is PersistedPlaylistQueryRow => Boolean(row));

  const rowsById = Object.fromEntries(rows.map((row) => [row.playlistItem.playlistItemId, row]));
  const idsByCategory: Record<string, string[]> = {};
  const idsBySearchGram: Record<string, string[]> = {};

  rows.forEach((row) => {
    const rowId = row.playlistItem.playlistItemId;
    const category = row.track.category ?? "";
    if (category) {
      const categoryRows = idsByCategory[category] ?? (idsByCategory[category] = []);
      categoryRows.push(rowId);
    }
    buildSearchGrams(row.searchText).forEach((gram) => {
      const gramRows = idsBySearchGram[gram] ?? (idsBySearchGram[gram] = []);
      gramRows.push(rowId);
    });
  });

  return {
    rowsById,
    orderBy: {
      "playlist-position": sortRows(rows, "playlist-position").map((row) => row.playlistItem.playlistItemId),
      title: sortRows(rows, "title").map((row) => row.playlistItem.playlistItemId),
      path: sortRows(rows, "path").map((row) => row.playlistItem.playlistItemId),
    },
    idsByCategory,
    idsBySearchGram,
  };
};

const intersectInto = (current: Set<string> | null, values: string[]) => {
  if (current === null) return new Set(values);
  const next = new Set<string>();
  values.forEach((value) => {
    if (current.has(value)) next.add(value);
  });
  return next;
};

export const queryPlaylistIndex = (
  index: PersistedPlaylistQueryIndex,
  options: PlaylistQueryOptions,
): PlaylistQueryResult => {
  const sort = options.sort ?? "playlist-position";
  const orderedIds = index.orderBy[sort] ?? index.orderBy["playlist-position"];
  const normalizedQuery = normalizeQuery(options.query);
  let candidateIds: Set<string> | null = null;

  if (options.categoryFilter?.length) {
    const categoryIds = new Set<string>();
    options.categoryFilter.forEach((category) => {
      (index.idsByCategory[category] ?? []).forEach((rowId) => categoryIds.add(rowId));
    });
    candidateIds = intersectInto(candidateIds, [...categoryIds]);
  }

  const grams = buildSearchGrams(normalizedQuery);
  grams.forEach((gram) => {
    candidateIds = intersectInto(candidateIds, index.idsBySearchGram[gram] ?? []);
  });

  const offset = Math.max(0, options.offset);
  const limit = Math.max(1, options.limit);
  const rows: PlaylistQueryRow[] = [];
  let totalMatchCount = 0;

  orderedIds.forEach((rowId) => {
    if (candidateIds && !candidateIds.has(rowId)) return;
    const row = index.rowsById[rowId];
    if (!row) return;
    if (normalizedQuery && !row.searchText.includes(normalizedQuery)) return;
    totalMatchCount += 1;
    if (totalMatchCount <= offset) return;
    if (rows.length >= limit) return;
    rows.push({
      playlistItem: row.playlistItem,
      track: row.track,
    });
  });

  return {
    rows,
    totalMatchCount,
  };
};

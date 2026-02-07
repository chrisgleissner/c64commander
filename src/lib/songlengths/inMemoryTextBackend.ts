import type { SongLengthStoreBackend } from './songlengthBackend';
import type {
  SongLengthBackendStats,
  SongLengthLoadInput,
  SongLengthResolution,
  SongLengthResolveQuery,
} from './songlengthTypes';

type ParsedSongLengthEntry = {
  fullPath: string | null;
  fileName: string | null;
  md5: string | null;
  durations: number[];
  sourceFile: string;
  line: number;
};

type RejectLineHandler = (details: {
  sourceFile: string;
  line: number;
  raw: string;
  reason: string;
}) => void;

type AmbiguousHandler = (details: {
  fileName: string;
  partialPath: string | null;
  candidateCount: number;
  candidates: string[];
}) => void;

type InMemoryTextBackendOptions = {
  onRejectedLine?: RejectLineHandler;
  onAmbiguous?: AmbiguousHandler;
};

const clampRawLine = (value: string) => (value.length <= 400 ? value : `${value.slice(0, 400)}...`);

const normalizePath = (path: string) => {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized) return '/';
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash;
};

const normalizeMd5 = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizeFileName = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
};

const normalizePartialPath = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized = normalizePath(value).toLowerCase();
  return normalized === '/' ? null : normalized;
};

const extractFileName = (path: string) => normalizeFileName(path.split('/').pop() ?? null);

const parseDurationTokenToSeconds = (value: string): number | null => {
  const match = value.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fractional = Number((match[3] ?? '').padEnd(3, '0'));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(fractional)) return null;
  if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
  const totalMs = (minutes * 60 + seconds) * 1000 + fractional;
  return Math.round(totalMs / 1000);
};

const parseDurations = (value: string) => {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const durations: number[] = [];
  tokens.forEach((token) => {
    const match = token.match(/^(\d+:\d{2}(?:\.\d{1,3})?)/);
    if (!match?.[1]) return;
    const parsed = parseDurationTokenToSeconds(match[1]);
    if (parsed === null) return;
    durations.push(parsed);
  });
  return durations;
};

const parseSongLengthFile = (
  sourceFile: string,
  content: string,
  onRejectedLine: RejectLineHandler,
): ParsedSongLengthEntry[] => {
  const entries: ParsedSongLengthEntry[] = [];
  let currentPath: string | null = null;
  const lines = content.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = index + 1;
    const firstChar = line.charCodeAt(0);

    if (firstChar === 59 || firstChar === 35 || firstChar === 58) {
      const pathCandidate = line.replace(/^[:;#]+/, '').trim();
      if (!pathCandidate) {
        onRejectedLine({ sourceFile, line: lineNo, raw: clampRawLine(rawLine), reason: 'empty comment path marker' });
        return;
      }
      currentPath = normalizePath(pathCandidate);
      return;
    }

    if (firstChar === 91) return;

    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const md5 = normalizeMd5(line.slice(0, eqIndex));
      const durations = parseDurations(line.slice(eqIndex + 1));
      if (!md5) {
        onRejectedLine({ sourceFile, line: lineNo, raw: clampRawLine(rawLine), reason: 'invalid md5 key' });
        return;
      }
      if (!durations.length) {
        onRejectedLine({ sourceFile, line: lineNo, raw: clampRawLine(rawLine), reason: 'invalid duration payload' });
        return;
      }
      entries.push({
        fullPath: currentPath,
        fileName: currentPath ? extractFileName(currentPath) : null,
        md5,
        durations,
        sourceFile,
        line: lineNo,
      });
      return;
    }

    let splitIndex = -1;
    for (let i = 0; i < line.length; i += 1) {
      const code = line.charCodeAt(i);
      if (code === 32 || code === 9) {
        splitIndex = i;
        break;
      }
    }
    if (splitIndex <= 0) {
      onRejectedLine({ sourceFile, line: lineNo, raw: clampRawLine(rawLine), reason: 'unsupported line format' });
      return;
    }
    const parsedPath = normalizePath(line.slice(0, splitIndex));
    const durations = parseDurations(line.slice(splitIndex + 1));
    if (!durations.length) {
      onRejectedLine({ sourceFile, line: lineNo, raw: clampRawLine(rawLine), reason: 'invalid duration payload' });
      return;
    }
    entries.push({
      fullPath: parsedPath,
      fileName: extractFileName(parsedPath),
      md5: null,
      durations,
      sourceFile,
      line: lineNo,
    });
  });
  return entries;
};

type EntryRecord = {
  fullPathId: number;
  fileNameId: number;
  durationId: number;
  md5: string | null;
};

export type InMemorySongLengthSnapshot = {
  pathToSeconds: Map<string, number[]>;
  md5ToSeconds: Map<string, number[]>;
};

export class InMemoryTextBackend implements SongLengthStoreBackend {
  readonly backendId = 'in-memory-text';

  private configuredPath: string | null = null;
  private sourceLabel: string | null = null;
  private filesLoaded: string[] = [];
  private loadedAtIso: string | null = null;
  private rejectedLines = 0;

  private fullPaths: string[] = [];
  private fileNames: string[] = [];
  private durations: number[][] = [];
  private records: EntryRecord[] = [];

  private fullPathToEntryId = new Map<string, number>();
  private md5ToEntryId = new Map<string, number>();
  private uniqueFileNameToEntryId = new Map<string, number>();
  private duplicateFileNameToEntryIds = new Map<string, number[]>();

  constructor(private readonly options: InMemoryTextBackendOptions = {}) {}

  private intern(
    pool: string[],
    index: Map<string, number>,
    value: string,
  ) {
    const existing = index.get(value);
    if (typeof existing === 'number') return existing;
    const next = pool.length;
    pool.push(value);
    index.set(value, next);
    return next;
  }

  private internDurations(value: number[]) {
    const key = value.join(',');
    if (!this.durationIndex.has(key)) {
      this.durationIndex.set(key, this.durations.length);
      this.durations.push(value);
    }
    return this.durationIndex.get(key) as number;
  }

  private durationIndex = new Map<string, number>();

  async load(input: SongLengthLoadInput): Promise<void> {
    this.reset();
    this.configuredPath = input.configuredPath ?? null;
    this.sourceLabel = input.sourceLabel;
    this.filesLoaded = input.files.map((file) => file.path);
    this.loadedAtIso = new Date().toISOString();

    const parsed: ParsedSongLengthEntry[] = [];
    input.files.forEach((file) => {
      parsed.push(...parseSongLengthFile(
        file.path,
        file.content,
        ({ sourceFile, line, raw, reason }) => {
          this.rejectedLines += 1;
          this.options.onRejectedLine?.({ sourceFile, line, raw, reason });
        },
      ));
    });

    const pathIndex = new Map<string, number>();
    const fileNameIndex = new Map<string, number>();
    const fileNameBuckets = new Map<string, number[]>();

    parsed.forEach((entry) => {
      if (!entry.fullPath || !entry.fileName) return;
      const fullPathId = this.intern(this.fullPaths, pathIndex, entry.fullPath);
      const fileNameId = this.intern(this.fileNames, fileNameIndex, entry.fileName);
      const durationId = this.internDurations(entry.durations);
      const recordId = this.records.length;
      this.records.push({
        fullPathId,
        fileNameId,
        durationId,
        md5: entry.md5,
      });
      const normalizedFullPathKey = entry.fullPath.toLowerCase();
      if (!this.fullPathToEntryId.has(normalizedFullPathKey)) {
        this.fullPathToEntryId.set(normalizedFullPathKey, recordId);
      }
      if (entry.md5 && !this.md5ToEntryId.has(entry.md5)) {
        this.md5ToEntryId.set(entry.md5, recordId);
      }
      const bucket = fileNameBuckets.get(entry.fileName) ?? [];
      bucket.push(recordId);
      fileNameBuckets.set(entry.fileName, bucket);
    });

    fileNameBuckets.forEach((entryIds, fileName) => {
      if (entryIds.length === 1) {
        this.uniqueFileNameToEntryId.set(fileName, entryIds[0]);
      } else {
        this.duplicateFileNameToEntryIds.set(fileName, entryIds);
      }
    });
  }

  private resolveDuration(recordId: number, songNr?: number | null) {
    const record = this.records[recordId];
    if (!record) return null;
    const durationList = this.durations[record.durationId];
    if (!durationList?.length) return null;
    const index = songNr && songNr > 0 ? songNr - 1 : 0;
    if (index < 0 || index >= durationList.length) return null;
    return durationList[index] ?? null;
  }

  private toResolution(
    recordId: number,
    strategy: SongLengthResolution['strategy'],
    query: SongLengthResolveQuery,
  ): SongLengthResolution {
    const record = this.records[recordId];
    if (!record) return { durationSeconds: null, strategy: 'not-found' };
    return {
      durationSeconds: this.resolveDuration(recordId, query.songNr),
      strategy,
      matchedPath: this.fullPaths[record.fullPathId] ?? null,
      matchedMd5: record.md5,
      fileName: this.fileNames[record.fileNameId] ?? null,
    };
  }

  resolve(query: SongLengthResolveQuery): SongLengthResolution {
    if (!this.records.length) {
      return { durationSeconds: null, strategy: 'unavailable' };
    }

    const normalizedVirtualPath = query.virtualPath ? normalizePath(query.virtualPath).toLowerCase() : null;
    const normalizedMd5 = normalizeMd5(query.md5);
    const normalizedFileName = normalizeFileName(query.fileName)
      ?? normalizeFileName(normalizedVirtualPath?.split('/').pop() ?? null);
    const normalizedPartialPath = normalizePartialPath(query.partialPath)
      ?? normalizePartialPath(
        normalizedVirtualPath && normalizedVirtualPath.includes('/')
          ? normalizedVirtualPath.slice(0, normalizedVirtualPath.lastIndexOf('/'))
          : null,
      );
    let pendingAmbiguity: {
      fileName: string;
      partialPath: string | null;
      candidateEntryIds: number[];
    } | null = null;

    if (normalizedFileName) {
      const uniqueEntryId = this.uniqueFileNameToEntryId.get(normalizedFileName);
      if (typeof uniqueEntryId === 'number') {
        return this.toResolution(uniqueEntryId, 'filename-unique', query);
      }

      const duplicateEntryIds = this.duplicateFileNameToEntryIds.get(normalizedFileName);
      if (duplicateEntryIds?.length && normalizedPartialPath) {
        const candidates = duplicateEntryIds.filter((entryId) => {
          const path = (this.fullPaths[this.records[entryId]?.fullPathId ?? -1] ?? '').toLowerCase();
          return path.includes(normalizedPartialPath);
        });
        if (candidates.length === 1) {
          return this.toResolution(candidates[0], 'filename-partial-path', query);
        }
        if (candidates.length > 1) {
          pendingAmbiguity = {
            fileName: normalizedFileName,
            partialPath: normalizedPartialPath,
            candidateEntryIds: candidates,
          };
        }
      }
    }

    if (normalizedVirtualPath) {
      const fullPathEntryId = this.fullPathToEntryId.get(normalizedVirtualPath);
      if (typeof fullPathEntryId === 'number') {
        return this.toResolution(fullPathEntryId, 'full-path', query);
      }
    }

    if (normalizedMd5) {
      const md5EntryId = this.md5ToEntryId.get(normalizedMd5);
      if (typeof md5EntryId === 'number') {
        return this.toResolution(md5EntryId, 'md5', query);
      }
    }

    if (pendingAmbiguity) {
      this.options.onAmbiguous?.({
        fileName: pendingAmbiguity.fileName,
        partialPath: pendingAmbiguity.partialPath,
        candidateCount: pendingAmbiguity.candidateEntryIds.length,
        candidates: pendingAmbiguity.candidateEntryIds.map((entryId) => this.fullPaths[this.records[entryId]?.fullPathId ?? -1] ?? ''),
      });
      return {
        durationSeconds: null,
        strategy: 'ambiguous',
        fileName: pendingAmbiguity.fileName,
        candidateCount: pendingAmbiguity.candidateEntryIds.length,
      };
    }

    return { durationSeconds: null, strategy: 'not-found', fileName: normalizedFileName };
  }

  private estimateMemoryBytes() {
    const stringsBytes =
      this.fullPaths.reduce((sum, value) => sum + value.length * 2, 0)
      + this.fileNames.reduce((sum, value) => sum + value.length * 2, 0)
      + Array.from(this.md5ToEntryId.keys()).reduce((sum, value) => sum + value.length * 2, 0);
    const durationsBytes = this.durations.reduce((sum, value) => sum + value.length * 8, 0);
    const recordsBytes = this.records.length * 32;
    const indexBytes =
      (this.fullPathToEntryId.size + this.md5ToEntryId.size + this.uniqueFileNameToEntryId.size + this.duplicateFileNameToEntryIds.size) * 64;
    return stringsBytes + durationsBytes + recordsBytes + indexBytes;
  }

  stats(): SongLengthBackendStats {
    const duplicateEntries = Array.from(this.duplicateFileNameToEntryIds.values()).reduce((sum, ids) => sum + ids.length, 0);
    return {
      backend: this.backendId,
      configuredPath: this.configuredPath,
      sourceLabel: this.sourceLabel,
      filesLoaded: this.filesLoaded,
      entriesTotal: this.records.length,
      uniqueFileNames: this.uniqueFileNameToEntryId.size,
      duplicatedFileNames: this.duplicateFileNameToEntryIds.size,
      duplicateEntries,
      rejectedLines: this.rejectedLines,
      fullPathIndexSize: this.fullPathToEntryId.size,
      md5IndexSize: this.md5ToEntryId.size,
      estimatedMemoryBytes: this.estimateMemoryBytes(),
      loadedAtIso: this.loadedAtIso,
    };
  }

  exportSnapshot(): InMemorySongLengthSnapshot {
    const pathToSeconds = new Map<string, number[]>();
    const md5ToSeconds = new Map<string, number[]>();
    this.records.forEach((record) => {
      const path = this.fullPaths[record.fullPathId];
      const durations = this.durations[record.durationId];
      if (path && !pathToSeconds.has(path)) {
        pathToSeconds.set(path, durations);
      }
      if (record.md5 && !md5ToSeconds.has(record.md5)) {
        md5ToSeconds.set(record.md5, durations);
      }
    });
    return { pathToSeconds, md5ToSeconds };
  }

  reset() {
    this.configuredPath = null;
    this.sourceLabel = null;
    this.filesLoaded = [];
    this.loadedAtIso = null;
    this.rejectedLines = 0;
    this.fullPaths = [];
    this.fileNames = [];
    this.durations = [];
    this.records = [];
    this.durationIndex = new Map();
    this.fullPathToEntryId = new Map();
    this.md5ToEntryId = new Map();
    this.uniqueFileNameToEntryId = new Map();
    this.duplicateFileNameToEntryIds = new Map();
  }
}

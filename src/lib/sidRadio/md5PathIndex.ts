/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * `md5_48 → virtualPath[]` index derived from `Songlengths.md5` (spec §2.4).
 *
 * The Tiny similarity export identifies a tune only by `md5_48` (first 6 bytes
 * of the SID file's MD5). To *play* a neighbour we must resolve that identity
 * to an HVSC virtual path the playback router understands. `Songlengths.md5`
 * already lists, for every HVSC file, a comment line with the path followed by
 * `<full_md5>=<durations>` — the natural source of this reverse index.
 *
 * The index rides the HVSC songlengths finalize hook
 * (`reloadHvscSonglengthsOnConfigChange`) so it is never stale relative to the
 * installed HVSC, and it survives moves (content-addressed) — see §2.5. Only
 * built when SID Radio is enabled, so the songlengths path is unchanged with
 * the flag off (Prime Directive 7).
 */

const HEX12 = /^[0-9a-f]{12,}$/;

const normalizePath = (path: string): string => {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

/** First 12 hex chars (6 bytes) of a full MD5, lower-cased. */
export const md548FromFullMd5 = (fullMd5: string): string => fullMd5.trim().toLowerCase().slice(0, 12);

/**
 * Pure parse of `Songlengths.md5` content into `md5_48 → virtualPath[]`. Paths
 * for a shared prefix (HVSC duplicates) are de-duplicated and sorted
 * lexicographically for a deterministic tie-break (D14: lowest sorted path).
 */
export const parseMd548PathIndex = (content: string): Map<string, string[]> => {
  const buckets = new Map<string, Set<string>>();
  let currentPath = "";

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const first = line.charCodeAt(0);
    // Comment line (`;` `#` `:`) carries the path.
    if (first === 59 || first === 35 || first === 58) {
      const path = line.replace(/^[:;#]+/, "").trim();
      if (path) currentPath = normalizePath(path);
      continue;
    }
    if (first === 91) continue; // "[Database]" and similar section markers

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue; // md5 lines only; legacy path-first rows carry no md5
    const md5 = line.slice(0, eqIndex).trim().toLowerCase();
    if (!currentPath || !HEX12.test(md5)) continue;
    const md548 = md5.slice(0, 12);
    let set = buckets.get(md548);
    if (!set) {
      set = new Set<string>();
      buckets.set(md548, set);
    }
    set.add(currentPath);
  }

  const index = new Map<string, string[]>();
  for (const [md548, set] of buckets) index.set(md548, [...set].sort());
  return index;
};

export interface ResolveVirtualPathOptions {
  /** Predicate for whether a path resolves to an installed HVSC file (D14). */
  isInstalled?: (virtualPath: string) => boolean;
}

// --- module singleton store (rebuilt on the songlengths finalize hook) ---

let currentIndex = new Map<string, string[]>();
let lastContentHash: string | null = null;

// FNV-1a — cheap change detection so an unchanged reload is a no-op.
const hashContent = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`;
};

export interface RebuildMd548PathIndexResult {
  rebuilt: boolean;
  size: number;
}

/**
 * (Re)build the singleton index from one or more `Songlengths.md5` contents.
 * Skips an unchanged rebuild unless `force`. Never clobbers a populated index
 * with an empty parse (a pre-commit discovery that loads nothing must not wipe
 * radio resolution — mirrors the songlengths forced-reload hazard, HARD19-016).
 */
export const rebuildMd548PathIndex = (
  content: string | string[],
  options?: { force?: boolean },
): RebuildMd548PathIndexResult => {
  const text = Array.isArray(content) ? content.join("\n") : content;
  const hash = hashContent(text);
  if (!options?.force && hash === lastContentHash) {
    return { rebuilt: false, size: currentIndex.size };
  }
  const next = parseMd548PathIndex(text);
  if (next.size === 0 && currentIndex.size > 0) {
    return { rebuilt: false, size: currentIndex.size };
  }
  currentIndex = next;
  lastContentHash = hash;
  return { rebuilt: true, size: currentIndex.size };
};

/** Rebuild from discovered songlengths files, using only the `.md5` sources. */
export const rebuildMd548PathIndexFromFiles = (
  files: ReadonlyArray<{ path: string; content: string }>,
  options?: { force?: boolean },
): RebuildMd548PathIndexResult => {
  const md5Contents = files.filter((file) => file.path.toLowerCase().endsWith(".md5")).map((file) => file.content);
  if (md5Contents.length === 0) return { rebuilt: false, size: currentIndex.size };
  return rebuildMd548PathIndex(md5Contents, options);
};

/** Resolve a `md5_48` to a playable virtual path, or null (D14 tie-break). */
export const resolveVirtualPath = (md5_48: string, options?: ResolveVirtualPathOptions): string | null => {
  const paths = currentIndex.get(md5_48.toLowerCase());
  if (!paths || paths.length === 0) return null;
  if (options?.isInstalled) {
    const installed = paths.find((path) => options.isInstalled!(path));
    if (installed) return installed;
  }
  return paths[0];
};

/** All known paths for a `md5_48` (sorted; empty if unknown). */
export const virtualPathsForMd548 = (md5_48: string): string[] => currentIndex.get(md5_48.toLowerCase()) ?? [];

export const getMd548PathIndexStats = () => ({ size: currentIndex.size });

/** Test-only reset of the singleton. */
export const resetMd548PathIndex = (): void => {
  currentIndex = new Map<string, string[]>();
  lastContentHash = null;
};

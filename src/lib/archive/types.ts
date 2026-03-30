/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ArchivePresetType = "category" | "date" | "type" | "sort" | "order";

export type ArchivePresetValue = {
  aqlKey: string;
  name?: string;
};

export type ArchivePreset = {
  type: ArchivePresetType;
  description: string;
  values: ArchivePresetValue[];
};

export type ArchiveSearchParams = {
  name?: string;
  group?: string;
  handle?: string;
  event?: string;
  category?: string;
  date?: string;
  type?: string;
  sort?: string;
  order?: string;
};

export type ArchiveSearchResult = {
  name: string;
  id: string;
  category: number;
  siteCategory?: number;
  siteRating?: number;
  year?: number;
  rating?: number;
  updated?: string;
  group?: string;
  handle?: string;
  released?: string;
};

export type ArchiveEntry = {
  path: string;
  id: number;
  size?: number;
  date?: number;
};

export type ArchiveEntriesResponse = {
  contentEntry: ArchiveEntry[];
};

export type ArchiveBinary = {
  fileName: string;
  bytes: Uint8Array;
  contentType: string | null;
  url: string;
};

export type ArchivePlaylistReference = {
  sourceId: string;
  resultId: string;
  category: number;
  entryId: number;
  entryPath: string;
};

export type ArchiveClientConfigInput = {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  enabled?: boolean;
};

export type ArchiveClientResolvedConfig = {
  id: string;
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
  enabled: boolean;
  host: string;
  clientId: string;
  userAgent: string;
};

export type ArchiveRequestOptions = {
  signal?: AbortSignal;
};

export interface ArchiveClient {
  getPresets(options?: ArchiveRequestOptions): Promise<ArchivePreset[]>;
  search(params: ArchiveSearchParams, options?: ArchiveRequestOptions): Promise<ArchiveSearchResult[]>;
  getEntries(id: string, category: number, options?: ArchiveRequestOptions): Promise<ArchiveEntry[]>;
  getBinaryUrl(id: string, category: number, index: number): string;
  downloadBinary(
    id: string,
    category: number,
    index: number,
    fileName: string,
    options?: ArchiveRequestOptions,
  ): Promise<ArchiveBinary>;
  getResolvedConfig(): ArchiveClientResolvedConfig;
}

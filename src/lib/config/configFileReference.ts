/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type LocalConfigFileReference = {
  kind: "local";
  fileName: string;
  path?: string | null;
  sourceId?: string | null;
  uri?: string | null;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

export type UltimateConfigFileReference = {
  kind: "ultimate";
  fileName: string;
  path: string;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

export type ConfigFileReference = LocalConfigFileReference | UltimateConfigFileReference;

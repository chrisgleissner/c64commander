/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { AppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import type { SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import type { SourceEntry } from "@/lib/sourceNavigation/types";
import { isSupportedPlayFile } from "@/lib/playback/fileTypes";

const isSidPath = (path: string): boolean => /\.sid$/i.test(path);

/** What Add items lets through: every kind of playable file in the Full App, SID files and folders on a phone with no machine. */
export const addItemsEntryFilter =
  (appMode: AppMode) =>
  (entry: SourceEntry): boolean =>
    entry.type === "dir" || (appMode === "sid-player" ? isSidPath(entry.path) : isSupportedPlayFile(entry.path));

/** Add items offers the Ultimate as a source only where there can be one. */
export const addItemsSourceGroups = (appMode: AppMode, groups: SourceGroup[]): SourceGroup[] =>
  isSurfaceVisible("play:c64u-source", appMode)
    ? groups
    : groups.filter((group) => !group.sources.some((source) => source.type === "ultimate"));

/** The files the add handler itself accepts: the same rule as {@link addItemsEntryFilter}, applied to folders and archive entries. */
export const addItemsAcceptsPath =
  (appMode: AppMode) =>
  (path: string): boolean =>
    appMode !== "sid-player" || isSidPath(path);

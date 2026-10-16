/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";

export type PlaylistTypeGroupId = "songs" | "progs" | "disks";

export type PlaylistTypeGroup = {
  id: PlaylistTypeGroupId;
  label: string;
  categories: readonly PlayFileCategory[];
};

/** The playlist's type filter as the user sees it: every file category belongs to exactly one group. */
export const PLAYLIST_TYPE_GROUPS: readonly PlaylistTypeGroup[] = [
  { id: "songs", label: "Songs", categories: ["sid", "mod"] },
  { id: "progs", label: "Progs", categories: ["prg", "crt"] },
  { id: "disks", label: "Disks", categories: ["disk"] },
];

export const isPlaylistTypeGroupShown = (filters: readonly PlayFileCategory[], group: PlaylistTypeGroup) =>
  group.categories.every((category) => filters.includes(category));

/**
 * The categories to toggle so the whole group ends up shown, or hidden when it is shown now. A group
 * that is only partly shown is completed rather than emptied, so one press never hides files the
 * checkbox did not claim to be showing.
 */
export const playlistTypeGroupToggles = (
  filters: readonly PlayFileCategory[],
  group: PlaylistTypeGroup,
): PlayFileCategory[] => {
  const shown = isPlaylistTypeGroupShown(filters, group);
  return group.categories.filter((category) => filters.includes(category) === shown);
};

/** What the type filter restricts the playlist to, or null when it shows every type. */
export const describePlaylistTypeFilter = (filters: readonly PlayFileCategory[]): string | null => {
  const shown = PLAYLIST_TYPE_GROUPS.filter((group) => isPlaylistTypeGroupShown(filters, group));
  if (shown.length === PLAYLIST_TYPE_GROUPS.length) return null;
  if (shown.length === 0) return "No types";
  return shown.map((group) => group.label).join(", ");
};

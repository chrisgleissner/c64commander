/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What to do with a song the ROM dependency list says sounds different on this phone.
 *
 * Pure, so the whole table can be tested without a player. The inputs are facts the play path
 * already has; the answer says where the song goes next.
 *
 *   c64     A C64 is there to play it, with its own ROMs. This is the existing ROM fallback, unchanged.
 *   phone   Play it here anyway: the listener turned skipping off.
 *   continue  The listener is already listening to it (a repeat, or a move to this phone): it plays on.
 *   skip    A playlist or station moving on by itself passes over it.
 *   ask     The listener chose it: say what is wrong and let them decide.
 *   blocked The listener chose a song this phone cannot play at all (a BASIC program, with no BASIC ROM and
 *           no C64 to supply it): say so, with nothing to decide. A playlist moving on still passes over it.
 */

export type RomListedPlayback = "c64" | "phone" | "continue" | "skip" | "ask" | "blocked";

export interface RomListedPlaybackInput {
  /** A C64 that can play the song is reachable. False for no device, an offline device, and Demo Mode. */
  c64Usable: boolean;
  /** Settings → Play and disk → "Skip songs that need the C64 ROMs". */
  skipEnabled: boolean;
  /** The playlist or station is moving on by itself (`origin: "auto"`), not the listener choosing. */
  autoAdvance: boolean;
  /** The song already playing, started again by a repeat or a move between engines: it was accepted once. */
  accepted?: boolean;
  /** False when the local engine cannot play the song whatever the listener decides. Defaults to true. */
  playable?: boolean;
}

export const decideRomListedPlayback = ({
  c64Usable,
  skipEnabled,
  autoAdvance,
  accepted = false,
  playable = true,
}: RomListedPlaybackInput): RomListedPlayback => {
  if (c64Usable) return "c64";
  // Unplayable here: skipping is not optional and an earlier acceptance does not make it playable.
  if (!playable) return autoAdvance ? "skip" : "blocked";
  if (!skipEnabled) return "phone";
  if (accepted) return "continue";
  return autoAdvance ? "skip" : "ask";
};

/** Plain-language copy, shared by the notice, the dialog and the tests. */
export const romListedSkippedNotice = (label: string) =>
  `Skipped “${label}”: it needs the C64 ROMs. Connect your C64 to play it, or turn off ` +
  `“Skip songs that need the C64 ROMs” in Settings → Play and disk.`;

export const romUnplayableSkippedNotice = (label: string) =>
  `Skipped “${label}”: it needs the C64 ROMs to start, which this phone does not have. Connect your C64 to play it.`;

export const ROM_LISTED_DIALOG_TITLE = "Needs the C64 ROMs";

export const romListedDialogText = (label: string) =>
  `“${label}” needs the C64’s ROMs to play correctly on this phone. Connect your C64 to play it ` +
  `there, or play it here anyway and it may sound wrong.`;

export const ROM_BASIC_DIALOG_TITLE = "Needs the C64’s BASIC ROM";

export const romBasicDialogText = () =>
  "This tune is a BASIC program and needs the C64’s BASIC ROM. Connect a C64, or add the ROMs in Settings.";

/** What the dialog is asking: a decision about a song that may sound wrong, or a notice about one that cannot play. */
export type RomDialogKind = "listed" | "needs-basic";

export type RomListedDialogChoice = "play-anyway" | "cancel";

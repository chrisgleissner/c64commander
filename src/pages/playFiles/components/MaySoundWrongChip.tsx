/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const MAY_SOUND_WRONG_LABEL = "May sound wrong";

export const MAY_SOUND_WRONG_HINT =
  "This song needs the C64 ROMs, which this phone does not have, so it may sound wrong.";

/** Plain text, not a control: it takes no focus stop and sits in the title row, so the card keeps its height. */
export const MaySoundWrongChip = () => (
  <span
    className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 text-sm font-normal leading-5 text-foreground"
    data-testid="may-sound-wrong-chip"
    title={MAY_SOUND_WRONG_HINT}
  >
    {MAY_SOUND_WRONG_LABEL}
  </span>
);

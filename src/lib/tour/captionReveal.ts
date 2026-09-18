/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether the tour's caption should step back and let the page it is describing show through.
 *
 * The tour spotlights the real app and captions it, so it is worth only as much as the app still
 * being visible. Measured on the narrowest screen the app supports, 320 x 427 CSS px: the caption
 * covered 66% to 81% of the height, and on the worst step nothing of the page underneath could be
 * seen at all. Shorter captions took that to 62–68%, which is still most of the screen, because the
 * rest is the panel itself — a progress line, a title, a row of buttons and the system inset.
 *
 * So after a few idle seconds the panel drops its body paragraph and keeps its title, its progress
 * line and its buttons. The panel shrinks to about half what it was and the page appears below it,
 * both of them fully legible.
 *
 * Fading the whole panel was tried first and was worse than the problem: at a quarter opacity the
 * caption's own words and the page's words sat on top of each other and neither could be read.
 *
 * Three rules keep the collapse from being a way of hiding anything:
 *
 *   * The title stays, so what is spotlighted is still named, and the buttons never move or change.
 *   * Any interaction at all brings the body straight back, including moving the keypad focus —
 *     which is the only kind of interaction some devices have.
 *   * It happens only where the problem is. A caption that leaves most of the screen showing is not
 *     in the way, so on those the body never goes.
 */

/** Below this share of the viewport the caption is not in the way, so its body always stays. */
export const CAPTION_CROWDING_SHARE = 0.5;

/** Long enough to read two lines twice over before anything moves. */
export const CAPTION_IDLE_MS = 6000;

export interface CaptionRevealInput {
  /** The caption panel's height in CSS pixels. */
  readonly captionHeight: number;
  /** The viewport height in CSS pixels. */
  readonly viewportHeight: number;
  /** Milliseconds since the user last did anything. */
  readonly idleMs: number;
}

/**
 * Whether the caption should be showing its body right now.
 *
 * A separate pure function because the thing worth testing is the decision, not the timer that
 * feeds it: a caption that crowds the screen and has been left alone gives the page back, and
 * nothing else does.
 */
export const showsCaptionBody = ({ captionHeight, viewportHeight, idleMs }: CaptionRevealInput): boolean => {
  if (viewportHeight <= 0) return true;
  if (captionHeight / viewportHeight < CAPTION_CROWDING_SHARE) return true;
  return idleMs < CAPTION_IDLE_MS;
};

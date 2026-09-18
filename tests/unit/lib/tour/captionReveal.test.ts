/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { CAPTION_CROWDING_SHARE, CAPTION_IDLE_MS, showsCaptionBody } from "@/lib/tour/captionReveal";

/*
 * Measured on the narrowest screen the app supports, 320 x 427 CSS px: the tour's caption covered
 * 66% to 81% of the height and the page it was describing could not be seen at all. These are the
 * numbers from that screen.
 */
const SMALL_SCREEN = 427;
const CROWDING_CAPTION = 281;
const MODEST_CAPTION = 180;

describe("when the tour caption steps back", () => {
  it("keeps the body while the user is still doing something", () => {
    expect(showsCaptionBody({ captionHeight: CROWDING_CAPTION, viewportHeight: SMALL_SCREEN, idleMs: 0 })).toBe(true);
    expect(
      showsCaptionBody({ captionHeight: CROWDING_CAPTION, viewportHeight: SMALL_SCREEN, idleMs: CAPTION_IDLE_MS - 1 }),
    ).toBe(true);
  });

  it("drops the body once a crowding caption has been left alone", () => {
    expect(
      showsCaptionBody({ captionHeight: CROWDING_CAPTION, viewportHeight: SMALL_SCREEN, idleMs: CAPTION_IDLE_MS }),
    ).toBe(false);
  });

  /*
   * A caption that leaves most of the screen showing is not in the way, so there is nothing to step
   * back from. Without this the panel would fade on a tablet, where it covers a fifth of the page.
   */
  it("never drops the body of a caption that is not in the way", () => {
    expect(showsCaptionBody({ captionHeight: MODEST_CAPTION, viewportHeight: 900, idleMs: CAPTION_IDLE_MS * 10 })).toBe(
      true,
    );
  });

  it("treats the share as the boundary it is", () => {
    const atBoundary = SMALL_SCREEN * CAPTION_CROWDING_SHARE;
    expect(showsCaptionBody({ captionHeight: atBoundary, viewportHeight: SMALL_SCREEN, idleMs: CAPTION_IDLE_MS })).toBe(
      false,
    );
    expect(
      showsCaptionBody({ captionHeight: atBoundary - 1, viewportHeight: SMALL_SCREEN, idleMs: CAPTION_IDLE_MS }),
    ).toBe(true);
  });

  it("keeps the body rather than dividing by a viewport it has not measured yet", () => {
    expect(showsCaptionBody({ captionHeight: CROWDING_CAPTION, viewportHeight: 0, idleMs: CAPTION_IDLE_MS })).toBe(
      true,
    );
  });

  /*
   * Long enough to read the caption twice before it gives the page back, and short enough that a
   * user looking at the spotlight does not wait for it.
   */
  it("waits long enough to be read first", () => {
    expect(CAPTION_IDLE_MS).toBeGreaterThanOrEqual(4000);
    expect(CAPTION_IDLE_MS).toBeLessThanOrEqual(10000);
  });
});

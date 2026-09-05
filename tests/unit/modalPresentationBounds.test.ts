/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolveModalPresentation } from "@/lib/modalPresentation";
import type { DisplayProfile } from "@/lib/displayProfile";

/*
 * A dialog that cannot be scrolled must not be able to grow past the screen.
 *
 * The Demo Mode offer did exactly that on the 480x640 panel this app is built for: its message
 * filled the viewport, its "Continue in Demo Mode" button sat below the fold, and because the
 * surface was `overflow-hidden` with no height bound there was no way to reach it — by touch or
 * from the accessibility tree. A user could read the offer and had no way to accept it.
 */
describe("centred dialogs stay inside the screen", () => {
  const profiles: DisplayProfile[] = ["small", "standard", "large"];

  for (const profile of profiles) {
    it(`bounds the default dialog to the viewport and scrolls it (${profile})`, () => {
      const { contentClassName } = resolveModalPresentation(profile, "default");

      expect(contentClassName).toContain("max-h-[calc(100dvh-2rem)]");
      expect(contentClassName).toContain("overflow-y-auto");
    });
  }

  it("keeps the scrolling class after the base class, so it wins the merge", () => {
    const { contentClassName } = resolveModalPresentation("standard", "default");

    expect(contentClassName.lastIndexOf("overflow-y-auto")).toBeGreaterThan(
      contentClassName.indexOf("overflow-hidden"),
    );
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

/**
 * Starting a station from the tune you are listening to.
 *
 * Hearing something you like is what makes you want more of it — and until this, the control that
 * does that was hidden for as long as a station was running. Wanting more of the tune a station just
 * served meant stopping the station, which threw away the very thing that prompted the thought, and
 * then finding the tune again. The obvious move was the awkward one.
 */
describe("PlayFilesPage station seeding", () => {
  it("offers the seed action while a station is already running", () => {
    // The gate used to include `!sidRadio.active`. It must not: that is precisely the moment the
    // action is wanted.
    const gate = pageSource.match(/\{sidRadioFlags\.sidRadioEnabled &&[^?]*\?/);
    expect(gate, "expected the seed button's render gate to be findable").not.toBeNull();
    expect(gate?.[0]).not.toContain("!sidRadio.active");
    expect(pageSource).toContain('data-testid="sid-radio-start"');
  });

  it("names the action after what it does rather than after starting something", () => {
    expect(pageSource).toContain("More like this");
  });

  it("re-seeds from whatever is playing, in one tap and with no confirmation", () => {
    expect(pageSource).toMatch(
      /data-testid="sid-radio-start"[\s\S]{0,400}?sidRadio\.startSongRadio\(currentSeedMd548,/,
    );
  });

  /**
   * The tracks that most often prompt "more like this" are the ones a hash cannot identify.
   *
   * Hashing the tune's bytes only works for something the app is holding a file for. A track a
   * station served — or one found by name — is a path and a subsong, with no blob attached until
   * playback resolves one, so the button would have stayed hidden for exactly the tracks it exists
   * for. The archive index turns the path straight into the identity the corpus uses.
   */
  it("resolves the seed from the archive index when there are no bytes to hash", () => {
    expect(pageSource).toContain("const currentSeedMd548 =");
    expect(pageSource).toContain("md548ForVirtualPath(currentItem.path)");
  });

  it("uses the same resolution for the launcher's mood choices", () => {
    // Otherwise "Similar to <tune>" would be offered in one place and missing in the other for the
    // same track.
    expect(pageSource).toMatch(
      /if \(!currentSeedMd548\) return;\s*\n\s*void sidRadio\.startSongRadio\(currentSeedMd548,/,
    );
  });
});

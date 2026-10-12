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

const playFilesPage = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/pages/PlayFilesPage.tsx"),
  "utf8",
);

describe("PlayFilesPage spectrum wiring", () => {
  it("keeps the spectrum live for mirror audio and only pauses it when that is the sole local source", () => {
    expect(playFilesPage).toContain('import { useAvMirror } from "@/hooks/useAvMirror";');
    expect(playFilesPage).toContain("const spectrumHasPhoneAudio = localEngineActive || mirror.audioLive;");
    expect(playFilesPage).toContain("const spectrumPaused = localEngineActive && !mirror.audioLive && isPaused;");
    expect(playFilesPage).toContain('<SpectrumCard soundOnPhone={spectrumHasPhoneAudio} paused={spectrumPaused} />');
  });
});

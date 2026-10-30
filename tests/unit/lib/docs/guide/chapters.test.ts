/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildGuideChapters } from "@/lib/docs/guide/chapters";
import { keypadChapter } from "@/lib/docs/guide/helpChapters";
import type { GuideChapter } from "@/lib/docs/guide/types";

const MACHINE_AND_HELP_IDS = [
  "disks",
  "remote-input",
  "game-mode",
  "live-view",
  "config",
  "save-restore",
  "devices",
  "connection-problems",
  "status-badge",
];

const idsFor = (appMode: "full" | "sid-player", variantId = "c64commander") =>
  buildGuideChapters({ variantId, flags: {}, appMode }).map((chapter) => chapter.id);

const textOf = (chapter: GuideChapter) =>
  chapter.blocks
    .flatMap((block) =>
      block.kind === "keys"
        ? block.items.map((item) => `${item.key} ${item.action}`)
        : "text" in block
          ? [block.text]
          : block.items,
    )
    .join("\n");

describe("guide chapters by app mode", () => {
  it("SPM-DOC-01 SID Player guide omits machine chapters", () => {
    const ids = idsFor("sid-player");
    for (const id of MACHINE_AND_HELP_IDS) expect(ids, id).not.toContain(id);
    for (const id of ["getting-started", "play", "find-tune", "playlist", "sid-radio", "keypad", "diagnostics"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("SPM-DOC-01 both modes include the SID Player chapter", () => {
    expect(idsFor("sid-player")).toContain("sid-player");
    expect(idsFor("full")).toContain("sid-player");
  });

  it("SPM-DOC-01 the Full App keeps every machine chapter it had", () => {
    const ids = idsFor("full");
    for (const id of ["disks", "config", "save-restore", "devices", "connection-problems", "status-badge"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("SPM-DOC-01 a missing mode means the Full App", () => {
    expect(buildGuideChapters({ variantId: "c64commander", flags: {} }).map((chapter) => chapter.id)).toEqual(
      idsFor("full"),
    );
  });

  it("SPM-DOC-01 SID Player getting started names three pages and no C64 setup", () => {
    const chapter = buildGuideChapters({ variantId: "c64commander", flags: {}, appMode: "sid-player" })[0];
    expect(textOf(chapter)).toContain("Play");
    expect(textOf(chapter)).toMatch(/`1` to `3`/);
    expect(textOf(chapter)).not.toMatch(/Web Remote Control|FTP File Service|Host or IP/);
  });

  it("SPM-DOC-01 the SID Player keypad cheat sheet lists digits 1 to 3 and no machine key", () => {
    const text = textOf(keypadChapter({ variantId: "c64commander", flags: {}, appMode: "sid-player" }));
    expect(text).toContain("`1` to `3`");
    expect(text).not.toMatch(/Reset the machine|Pause or resume the machine|Game Mode|Switch device/);
  });

  it("SPM-DOC-01 the SID Player chapter says how to leave and names no percentage", () => {
    const chapter = buildGuideChapters({ variantId: "c64commander", flags: {}, appMode: "sid-player" }).find(
      (candidate) => candidate.id === "sid-player",
    );
    const text = textOf(chapter!);
    expect(text).toContain("Leave SID Player");
    expect(text).not.toMatch(/\d+ ?%/);
  });
});

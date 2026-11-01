/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { TOUR_STEPS, stepBody, tourStepIndex, tourStepsFor } from "@/lib/tour/steps";
import { TAB_ROUTES, visibleTabIndexes } from "@/lib/navigation/tabRoutes";

const sidPlayerSteps = () => tourStepsFor("sid-player");

describe("tourStepsFor", () => {
  it("SPM-TOUR-01 the Full App tours every step", () => {
    expect(tourStepsFor("full")).toBe(TOUR_STEPS);
  });

  it("SPM-TOUR-01 SID Player tour has no device or Disks step", () => {
    const ids = sidPlayerSteps().map((step) => step.id);
    for (const id of ["disks", "connecting", "controlling-the-machine", "live-view", "configuration"]) {
      expect(ids, id).not.toContain(id);
    }
    expect(sidPlayerSteps().some((step) => step.requiresDevice)).toBe(false);
    expect(ids).toEqual([
      "what-this-is",
      "listening-without-a-c64",
      "playlists",
      "getting-around",
      "docs",
      "making-it-yours",
    ]);
  });

  it("SPM-TOUR-01 no SID Player step points at a page the mode hides", () => {
    const visiblePaths = visibleTabIndexes("sid-player").map((index) => TAB_ROUTES[index].path);
    for (const step of sidPlayerSteps()) {
      if (step.anchor) expect(visiblePaths, step.id).toContain(step.anchor.path);
    }
  });

  it("SPM-TOUR-01 the steps anchored on Home are re-anchored to Play", () => {
    const byId = new Map(sidPlayerSteps().map((step) => [step.id, step]));
    expect(byId.get("listening-without-a-c64")?.anchor?.path).toBe("/play");
    expect(byId.has("search")).toBe(false);
    expect(byId.has("your-tunes")).toBe(false);
    expect(TOUR_STEPS.find((step) => step.id === "search")?.anchor?.path).toBe("/");
  });

  it("SPM-TOUR-01 SID Player key step names the visible tab count", () => {
    const step = sidPlayerSteps().find((candidate) => candidate.id === "getting-around")!;
    expect(stepBody(step, { hvscInstalled: false })).toContain(
      `1 to ${visibleTabIndexes("sid-player").length} open pages`,
    );
    expect(
      stepBody(
        TOUR_STEPS.find((candidate) => candidate.id === "getting-around")!,
        { hvscInstalled: false },
      ),
    ).toContain("1 to 6 open pages");
  });

  it("SPM-TOUR-01 Welcome and Build a playlist use SID Player wording", () => {
    const byId = new Map(sidPlayerSteps().map((step) => [step.id, step]));
    expect(stepBody(byId.get("what-this-is")!, { hvscInstalled: false })).toBe("Plays C64 music on this phone.");
    expect(stepBody(byId.get("playlists")!, { hvscInstalled: false })).not.toMatch(/C64\b/);
  });

  it("SPM-TOUR-01 step lookup works within the list it is given", () => {
    expect(tourStepIndex("docs", sidPlayerSteps())).toBe(4);
    expect(tourStepIndex("disks", sidPlayerSteps())).toBe(0);
  });
});

describe("SPM-TOUR-01 SID Player tour anchors", () => {
  it("point at controls that exist whatever the playlist holds", () => {
    const anchored = tourStepsFor("sid-player").flatMap((step) => step.anchor?.testIds ?? []);
    expect(anchored.filter((id) => id.startsWith("home-tile-action."))).toEqual([]);
  });

  it("SPM-TONE-01 SID Player tour captions avoid the jargon list", () => {
    for (const step of tourStepsFor("sid-player")) {
      const text = `${step.title} ${stepBody(step, { hvscInstalled: false } as never)}`;
      expect(text, step.id).not.toMatch(/\b(REST|FTP|Telnet|host|IP|PAL|NTSC|dB|KERNAL|BASIC)\b/);
    }
  });

  it("SPM-TOUR-01 no two neighboring SID Player steps highlight the same control", () => {
    const anchors = tourStepsFor("sid-player").map((step) => step.anchor?.testIds?.join(",") ?? "");
    anchors.slice(1).forEach((anchor, index) => {
      if (anchor) expect(anchor, `step ${index + 1}`).not.toBe(anchors[index]);
    });
  });
});

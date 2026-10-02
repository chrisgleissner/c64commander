/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The parts of the HIL investigation instruments that can be checked without a rig: the profile
 * arithmetic, the name recovery for minified frames, reading a build's env back out of its bundle,
 * matching rebuilt chunks to an APK's, the audio stats summary, and where a kept run is written.
 */

import { describe, expect, it } from "vitest";

import { aggregateProfile, nameFromSourceLine, tidySource } from "../../../tools/hil/symbolize_cpuprofile.mjs";
import { chunkPrefix, embeddedViteEnv, matchChunks } from "../../../tools/hil/build_sourcemapped.mjs";
import { summarizeAudioStats } from "../../../tools/hil/app_audio_stats.mjs";
import { keptStageDir } from "../../../tools/hil/gate_evidence.mjs";

const frame = (functionName: string, url = "http://localhost/assets/index-abc12345.js") => ({
  functionName,
  url,
  scriptId: "1",
  lineNumber: 0,
  columnNumber: 0,
});

describe("aggregateProfile", () => {
  /*
   * root -> a -> b -> a (recursion) ; root -> (idle)
   * samples: b (1 ms), inner a (2 ms), idle (5 ms)
   */
  const profile = {
    nodes: [
      { id: 1, callFrame: frame("(root)", ""), children: [2, 5] },
      { id: 2, callFrame: frame("a"), children: [3] },
      { id: 3, callFrame: frame("b"), children: [4] },
      { id: 4, callFrame: frame("a"), children: [] },
      { id: 5, callFrame: frame("(idle)", ""), children: [] },
    ],
    samples: [3, 4, 5],
    timeDeltas: [1000, 2000, 5000],
  };
  const key = (callFrame: { functionName: string }) => callFrame.functionName;

  it("counts a recursive function once per sample in total time", () => {
    const result = aggregateProfile(profile, key);
    expect(result.self.get("a")).toBe(2);
    expect(result.self.get("b")).toBe(1);
    expect(result.total.get("a")).toBe(3);
    expect(result.total.get("b")).toBe(3);
  });

  it("separates idle time from busy time", () => {
    const result = aggregateProfile(profile, key);
    expect(result.wallMs).toBe(8);
    expect(result.idleMs).toBe(5);
    expect(result.busyMs).toBe(3);
    expect(result.self.has("(idle)")).toBe(false);
  });

  it("assigns a sample to the first group whose pattern is on its stack", () => {
    const result = aggregateProfile(profile, key, [
      { name: "only-b", pattern: /^b$/ },
      { name: "any-a", pattern: /^a$/ },
    ]);
    expect(result.grouped.get("only-b")).toBe(3);
    expect(result.grouped.get("any-a")).toBe(0);
  });
});

describe("nameFromSourceLine", () => {
  it.each([
    ["export const eventMatchesDeviceScope = (event, scope) => {", "eventMatchesDeviceScope"],
    ["export function useHealthState(): OverallHealthState {", "useHealthState"],
    ["  const handler = async (value: string) => run(value);", "handler"],
    ["  scopeEvents(events, scope) {", "scopeEvents"],
  ])("reads the declared name from %s", (line, name) => {
    expect(nameFromSourceLine(line, 0)).toBe(name);
  });

  it("returns null for a line that declares nothing", () => {
    expect(nameFromSourceLine("  return events.filter(Boolean);", 0)).toBeNull();
  });
});

describe("tidySource", () => {
  it("keeps the recognisable part of a source path", () => {
    expect(tidySource("../../src/lib/search/score.ts")).toBe("src/lib/search/score.ts");
    expect(tidySource("../../node_modules/react-dom/cjs/x.js")).toBe("node_modules/react-dom/cjs/x.js");
  });
});

describe("embeddedViteEnv", () => {
  it("reads the VITE_ entries, including a JSON string holding braces", () => {
    const code =
      'var a=1;const Xe={BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1,VITE_APP_VERSION:"1.0.7-rc3-be11a",' +
      'VITE_BUILD_TIME:"2026-10-02T09:36:23Z",VITE_DEBUG_SAVED_DEVICES_JSON:\'[{"id":"d","host":"h"}]\',' +
      'VITE_GIT_SHA:"be11a2bda"},Ye=2;';
    expect(embeddedViteEnv(code)).toEqual({
      VITE_APP_VERSION: "1.0.7-rc3-be11a",
      VITE_BUILD_TIME: "2026-10-02T09:36:23Z",
      VITE_DEBUG_SAVED_DEVICES_JSON: '[{"id":"d","host":"h"}]',
      VITE_GIT_SHA: "be11a2bda",
    });
  });

  it("refuses a bundle with no inlined env", () => {
    expect(() => embeddedViteEnv("var a=1;")).toThrow(/no inlined import.meta.env/);
  });
});

describe("matchChunks", () => {
  const file = (name: string, text: string) => ({ name, bytes: Buffer.from(text) });

  it("distinguishes an exact match, a renamed identical chunk, a changed chunk and a missing one", () => {
    const rows = matchChunks(
      [
        file("index-AAAAAAAA.js", "x"),
        file("vendor-BBBBBBBB.js", "y"),
        file("page-CCCCCCCC.js", "z"),
        file("gone-DDDDDDDD.js", "w"),
      ],
      [file("index-AAAAAAAA.js", "x"), file("vendor-EEEEEEEE.js", "y"), file("page-FFFFFFFF.js", "changed")],
    );
    expect(rows.map((row) => row.match)).toEqual(["exact", "content", "differs", "missing"]);
    expect(chunkPrefix("vendor-misc-BE-EPW9R.js")).toBe("vendor-misc");
  });
});

describe("summarizeAudioStats", () => {
  it("reports depth ranges and counter growth over the good samples only", () => {
    const summary = summarizeAudioStats([
      {
        hostEpochMs: 0,
        stats: {
          bufferedMs: 300,
          jitterBufferMs: 200,
          targetJitterMs: 180,
          concealedMs: 10,
          droppedBytes: 0,
          underruns: 1,
        },
      },
      { hostEpochMs: 250, stats: { error: "not available" } },
      {
        hostEpochMs: 500,
        stats: {
          bufferedMs: 780,
          jitterBufferMs: 680,
          targetJitterMs: 180,
          concealedMs: 40,
          droppedBytes: 512,
          underruns: 1,
        },
      },
      {
        hostEpochMs: 750,
        stats: {
          bufferedMs: 320,
          jitterBufferMs: 220,
          targetJitterMs: 180,
          concealedMs: 40,
          droppedBytes: 512,
          underruns: 2,
        },
      },
    ]);
    expect(summary.failed).toBe(1);
    expect(summary.bufferedMs).toEqual({ min: 300, median: 320, max: 780 });
    expect(summary.concealedMsGrowth).toBe(30);
    expect(summary.droppedBytesGrowth).toBe(512);
    expect(summary.underrunsGrowth).toBe(1);
  });
});

describe("keptStageDir", () => {
  it("names a stage directory per run and host, and nothing without --keep-dir", () => {
    expect(keptStageDir("", "2026-10-02T10-00-00-000Z", "c64u", "av-clarity")).toBeNull();
    expect(keptStageDir("/tmp/keep", "2026-10-02T10-00-00-000Z", "c64u", "av-clarity")).toBe(
      "/tmp/keep/2026-10-02T10-00-00-000Z-c64u/av-clarity",
    );
  });
});

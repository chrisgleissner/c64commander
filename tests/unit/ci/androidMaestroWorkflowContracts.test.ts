import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("Android Maestro workflow contracts", () => {
  it("avoids blind bottom-edge taps in the shared launch subflow", () => {
    const flow = readRepoFile(".maestro", "subflows", "launch-and-wait.yaml");
    expect(flow).toContain('visible: "Home"');
    expect(flow).toContain('text: "Don\'t show again"');
    expect(flow).toContain('text: "OK"');
    expect(flow).not.toContain('visible: "C64 Commander"');
    expect(flow).not.toContain('point: "8%,95%"');
  });

  it("opens the play tab through app selectors instead of bottom-edge coordinates", () => {
    const flow = readRepoFile(".maestro", "perf-hvsc-baseline.yaml");
    expect(flow).toContain('visible: "Status: Ready"');
    expect(flow).toContain('assertVisible: "HVSC ready"');
    expect(flow).toContain('visible: "Run Ingest HVSC"');
    expect(flow).toContain('id: "hvsc-ingest"');
    expect(flow).toContain('visible: "Indexed "');
    expect(flow).toContain('assertVisible: "Playlist"');
    expect(flow).toContain("runFlow: perf-hvsc-setup-playlist.yaml");
    expect(flow).toContain('text: "Done"');
    expect(flow).toContain('text: "Retry connection"');
    expect(flow).not.toContain("10_Orbyte.sid");
  });

  it("covers deep HVSC browse traversal scenarios with explicit Hubbard_Rob navigation", () => {
    const flow = readRepoFile(".maestro", "perf-hvsc-browse-traversal.yaml");
    expect(flow).toContain('visible: "Open MUSICIANS"');
    expect(flow).toContain('tapOn: "Open MUSICIANS"');
    expect(flow).toContain('visible: "Open H"');
    expect(flow).toContain('tapOn: "Open H"');
    expect(flow).toContain('visible: "Open Hubbard_Rob"');
    expect(flow).toContain('tapOn: "Open Hubbard_Rob"');
    expect(flow).toContain('tapOn: "Root"');
  });

  it("covers playlist build, filter, and playback HVSC perf flows", () => {
    const playlistFlow = readRepoFile(".maestro", "perf-hvsc-setup-playlist.yaml");
    const filterHighFlow = readRepoFile(".maestro", "perf-hvsc-filter-high.yaml");
    const filterZeroFlow = readRepoFile(".maestro", "perf-hvsc-filter-zero.yaml");
    const filterLowFlow = readRepoFile(".maestro", "perf-hvsc-filter-low.yaml");
    const playbackFlow = readRepoFile(".maestro", "perf-hvsc-playback.yaml");

    expect(playlistFlow).toContain('visible: "Open DEMOS"');
    expect(playlistFlow).toContain('point: "9%, 45%"');
    expect(playlistFlow).toContain('point: "9%, 57%"');
    expect(playlistFlow).toContain('point: "9%, 62%"');
    expect(playlistFlow).toContain('tapOn: "Add to playlist"');
    expect(playlistFlow).toContain('visible: "Clear playlist"');
    expect(playlistFlow).toContain('text: "Root"');
    expect(playlistFlow).toContain("hvsc-perf-playlist");
    expect(playlistFlow).not.toContain("hvsc-perf-setup");
    expect(filterHighFlow).toContain('inputText: "hubbard"');
    expect(filterZeroFlow).toContain('inputText: "xyzzy123"');
    expect(filterLowFlow).toContain('inputText: "Commando"');
    expect(playbackFlow).toContain('id: "playlist-play"');
    expect(playbackFlow).toContain('visible: "Pause"');
  });

  it("Android benchmark runner exposes multi-loop and warmup parameters", () => {
    const script = readRepoFile("scripts", "run-hvsc-android-benchmark.sh");
    expect(script).toContain("--loops");
    expect(script).toContain("--warmup");
    expect(script).toContain('LOOPS="${LOOPS:-3}"');
    expect(script).toContain('WARMUP="${WARMUP:-1}"');
    expect(script).toContain("TOTAL_LOOPS=$((WARMUP + LOOPS))");
    expect(script).toContain("clear_smoke_snapshots");
    expect(script).toContain("pull_smoke_snapshots");
    expect(script).toContain("MEASURED_SMOKE_FILES");
  });

  it("Android budget assertion script exists with UX1 and T1-T6 coverage", () => {
    const script = readRepoFile("scripts", "hvsc", "assert-android-perf-budgets.mjs");
    expect(script).toContain("targetEvidence");
    expect(script).toContain("UX1");
    expect(script).toContain("T1");
    expect(script).toContain("T2");
    expect(script).toContain("T3");
    expect(script).toContain("T4");
    expect(script).toContain("T5");
    expect(script).toContain("T6");
    expect(script).toContain("HVSC_ANDROID_BUDGET_ENFORCE");
    expect(script).toContain("observation-only");
  });

  it("uses warm launch (no app restart) for flows that need the in-memory browse index", () => {
    const playlistFlow = readRepoFile(".maestro", "perf-hvsc-setup-playlist.yaml");
    const browseFlow = readRepoFile(".maestro", "perf-hvsc-browse-traversal.yaml");
    const launchWarm = readRepoFile(".maestro", "subflows", "launch-warm.yaml");

    // Both flows must use launch-warm, not launch-and-wait, to preserve the browse index
    expect(playlistFlow).toContain("runFlow: subflows/launch-warm.yaml");
    expect(browseFlow).toContain("runFlow: subflows/launch-warm.yaml");
    expect(playlistFlow).not.toContain("runFlow: subflows/launch-and-wait.yaml");
    expect(browseFlow).not.toContain("runFlow: subflows/launch-and-wait.yaml");

    // launch-warm must not stop the app
    expect(launchWarm).toContain("stopApp: false");
    expect(launchWarm).not.toContain("stopApp: true");
  });
});

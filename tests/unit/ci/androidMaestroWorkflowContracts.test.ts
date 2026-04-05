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
    expect(flow).toContain('id: "import-option-hvsc"');
    expect(flow).toContain('visible: "From HVSC"');
    expect(flow).toContain('text: "Done"');
    expect(flow).toContain('text: "Retry connection"');
  });

  it("covers deep HVSC browse traversal scenarios with explicit Hubbard_Rob navigation", () => {
    const flow = readRepoFile(".maestro", "perf-hvsc-browse-traversal.yaml");
    expect(flow).toContain('visible: "Open MUSICIANS"');
    expect(flow).toContain('tapOn: "Open MUSICIANS"');
    expect(flow).toContain('visible: "Open H"');
    expect(flow).toContain('tapOn: "Open H"');
    expect(flow).toContain('visible: "Open Hubbard_Rob"');
    expect(flow).toContain('tapOn: "Open Hubbard_Rob"');
    expect(flow).toContain('id: "navigate-root"');
  });

  it("covers playlist build, filter, and playback HVSC perf flows", () => {
    const playlistFlow = readRepoFile(".maestro", "perf-hvsc-playlist-build.yaml");
    const filterHighFlow = readRepoFile(".maestro", "perf-hvsc-filter-high.yaml");
    const filterZeroFlow = readRepoFile(".maestro", "perf-hvsc-filter-zero.yaml");
    const filterLowFlow = readRepoFile(".maestro", "perf-hvsc-filter-low.yaml");
    const playbackFlow = readRepoFile(".maestro", "perf-hvsc-playback.yaml");

    expect(playlistFlow).toContain('visible: "Select DEMOS"');
    expect(playlistFlow).toContain('visible: "Select GAMES"');
    expect(playlistFlow).toContain('visible: "Select MUSICIANS"');
    expect(playlistFlow).toContain('id: "add-items-confirm"');
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

  it("Android budget assertion script exists with T1-T5 coverage", () => {
    const script = readRepoFile("scripts", "hvsc", "assert-android-perf-budgets.mjs");
    expect(script).toContain("targetEvidence");
    expect(script).toContain("T1");
    expect(script).toContain("T2");
    expect(script).toContain("T3");
    expect(script).toContain("T4");
    expect(script).toContain("T5");
    expect(script).toContain("HVSC_ANDROID_BUDGET_ENFORCE");
    expect(script).toContain("observation-only");
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const runnerPath = resolve(dirname(testFilePath), "../../../tmp/playback-volume-soak-runner.mjs");
const runnerSource = readFileSync(runnerPath, "utf8");

describe("playbackVolumeSoakRunner contracts", () => {
  it("restarts playback after changing the background duration input so the new due time is armed", () => {
    expect(runnerSource).toContain("const ensureDurationAppliedToActivePlayback = async");
    expect(runnerSource).toContain("await clickTestId(cdp, 'playlist-play');");
    expect(runnerSource).toContain("async () => (await getPageState(cdp)).playLabel === 'Play'");
    expect(runnerSource).toContain("await ensureDurationAppliedToActivePlayback(cdp, scenario, 6);");
  });

  it("commits controlled duration input writes and dedupes background watchdog logs by dueAtMs", () => {
    expect(runnerSource).toContain(
      "const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;",
    );
    expect(runnerSource).toContain("descriptor.set.call(input");
    expect(runnerSource).toContain("input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));");
    expect(runnerSource).toContain("await adb(['logcat', '-d', '-v', 'epoch'], { timeoutMs: 60_000 });");
    expect(runnerSource).toContain("const uniqueScheduleRows = dedupeByDueAtMs(scheduleRows);");
    expect(runnerSource).toContain("const uniqueFireRows = dedupeByDueAtMs(fireRows);");
    expect(runnerSource).toContain("const firedDueSet = new Set(uniqueFireRows.map((row) => row.dueAtMs));");
    expect(runnerSource).toContain("const boundaryRows = [...uniqueFireRows, ...scheduleOnlyRows]");
    expect(runnerSource).toContain(
      "const isEarlyFire = Boolean(fired && dueAtMs !== null && dueAtMs < firstExpectedDueAtMs);",
    );
  });

  it("samples V2 from the lightweight volume drag probe instead of the full page state loop", () => {
    expect(runnerSource).toContain("const readVolumeDragSample = async (cdp) =>");
    expect(runnerSource).toContain("root.querySelector('[data-testid=\"volume-slider-native-input\"]')");
    expect(runnerSource).toContain("root.querySelector('[data-testid=\"slider-value-display\"]')");
    expect(runnerSource).toContain(
      "const pointerTravelPx = Math.abs(samples[index].pointerX - samples[index - 1].pointerX);",
    );
    expect(runnerSource).toContain("pointerTravelPx >= minPointerTravelPx");
    expect(runnerSource).not.toContain(
      "const state = await getPageState(cdp);\n      samples.push({ tsMs: Date.now(), value: Number(state.volumeValue ?? 0), pointerX: x });",
    );
  });

  it("cancels residual swipe state after synthetic slider drags so Play layout does not stay shifted", () => {
    expect(runnerSource).toContain("swipeContainer.dispatchEvent(new PointerEvent('pointercancel'");
    expect(runnerSource).toContain("swipeContainer.dispatchEvent(new PointerEvent('pointerup'");
    expect(runnerSource).toContain("document.activeElement.blur();");
  });

  it("warms the V1 audio probe before judging direction from the U64 stream", () => {
    expect(runnerSource).toContain("durationMs: 4_000");
    expect(runnerSource).toContain("await sleep(1_200);");
    expect(runnerSource).toContain("beforeWindow: { startOffsetMs: -500, endOffsetMs: -100 }");
    expect(runnerSource).toContain("afterWindow: { startOffsetMs: 350, endOffsetMs: 1_900 }");
    expect(runnerSource).toContain(
      "const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;",
    );
    expect(runnerSource).toContain("input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));");
  });

  it("retries stale source-picker root recovery by cancelling and reopening once", () => {
    expect(runnerSource).toContain("const addPlaylistItems = async (cdp, desiredCount, attempt = 0) => {");
    expect(runnerSource).toContain("const findUniquePlaylistSelectionBatch = async (");
    expect(runnerSource).toContain("if (pickedHere.length > 0 || depth >= maxDepth) {");
    expect(runnerSource).toContain("return { picked: pickedHere, folderChain };");
    expect(runnerSource).toContain("if (childBatch.picked.length > 0) {");
    expect(runnerSource).toContain("selectedNames = selectionBatch.picked;");
    expect(runnerSource).toContain("const startingState = await getPageState(cdp);");
    expect(runnerSource).toContain("Playlist did not reflect confirmed add-items selection in time");
    expect(runnerSource).toContain("nextState.playlistCount >= startingState.playlistCount + selectedNames.length");
    expect(runnerSource).toContain("Playlist restore did not reach the required count before add-items fallback");
    expect(runnerSource).toContain("if (attempt > 0) throw error;");
    expect(runnerSource).toContain("const cancelled = await clickByText(cdp, '^Cancel$');");
    expect(runnerSource).toContain("return addPlaylistItems(cdp, desiredCount, attempt + 1);");
  });

  it("wakes and foregrounds the app before preflight when the device starts asleep", () => {
    expect(runnerSource).toContain("if (screenWakefulnessAtStart !== 'Awake') {");
    expect(runnerSource).toContain("await wakeAndForegroundApp();");
  });
});

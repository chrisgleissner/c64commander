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

  it("retries stale source-picker root recovery by cancelling and reopening once", () => {
    expect(runnerSource).toContain("const addPlaylistItems = async (cdp, desiredCount, attempt = 0) => {");
    expect(runnerSource).toContain("if (attempt > 0) throw error;");
    expect(runnerSource).toContain("const cancelled = await clickByText(cdp, '^Cancel$');");
    expect(runnerSource).toContain("return addPlaylistItems(cdp, desiredCount, attempt + 1);");
  });

  it("wakes and foregrounds the app before preflight when the device starts asleep", () => {
    expect(runnerSource).toContain("if (screenWakefulnessAtStart !== 'Awake') {");
    expect(runnerSource).toContain("await wakeAndForegroundApp();");
  });
});

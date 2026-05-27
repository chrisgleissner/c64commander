import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const playFilesPagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const playFilesPageSource = readFileSync(playFilesPagePath, "utf8");

describe("PlayFilesPage feature-flag contracts", () => {
  it("derives background execution from the feature-flag policy before touching the native bridge", () => {
    expect(playFilesPageSource).toContain(
      "const backgroundExecutionEnabled = isBackgroundExecutionEnabled(featureFlags);",
    );
    expect(playFilesPageSource).toContain("shouldStartBackgroundExecution({");
    expect(playFilesPageSource).toContain("shouldStopBackgroundExecution({");
    expect(playFilesPageSource).toContain("shouldSyncBackgroundExecutionDueAt(");
  });

  it("routes HVSC source and preparation behavior through the tightened HVSC feature policy", () => {
    expect(playFilesPageSource).toContain("shouldIncludeHvscSource(featureFlags, hvscAvailable)");
    expect(playFilesPageSource).toContain(
      "shouldOpenHvscPreparation(featureFlags, source.type, hvsc.hvscPreparationState)",
    );
    expect(playFilesPageSource).toContain(
      "shouldCancelHvscLifecycleOnDisable(hvscControlsEnabled, hvsc.hvscPreparationState)",
    );
  });

  it("turns Android background auto-skip callbacks into auto next transitions", () => {
    expect(playFilesPageSource).toContain("const registerBackgroundAutoSkipListener = async () => {");
    expect(playFilesPageSource).toContain("const nextHandle = await onBackgroundAutoSkipDue((event) => {");
    expect(playFilesPageSource).toContain("syncPlaybackTimeline({ allowAutoAdvance: false });");
    expect(playFilesPageSource).toContain("if (event.dueAtMs !== guard.dueAtMs) return;");
    expect(playFilesPageSource).toContain('await handleNext("auto", expectedTrackInstanceId);');
    expect(playFilesPageSource).toContain(
      "const backgroundDueWriteLaneRef = useRef<LatestIntentWriteLane<number | null> | null>(null);",
    );
    expect(playFilesPageSource).toContain("await BackgroundExecution.setDueAtMs({ dueAtMs: nextDueAtMs });");
    expect(playFilesPageSource).toContain(
      'addLog("debug", "Cleared background auto-advance watchdog after auto next with no remaining guard"',
    );
    expect(playFilesPageSource).toContain(
      'addLog("warn", "Background auto-advance did not move to a new track instance; cleared stale watchdog"',
    );
    expect(playFilesPageSource).toContain("setAutoAdvanceDueAtMs(null);");
    expect(playFilesPageSource).toContain("setAutoAdvanceDueAtMs(nextGuard.dueAtMs);");
    expect(playFilesPageSource).toContain("await queueBackgroundDueAtUpdate(null);");
    expect(playFilesPageSource).toContain("await queueBackgroundDueAtUpdate(nextGuard.dueAtMs);");
    expect(playFilesPageSource).toContain('addErrorLog("Failed to re-arm background auto-advance"');
    expect(playFilesPageSource).toContain('addErrorLog("Failed to register background auto-advance listener"');
  });

  it("stops background execution only on real cleanup, not on track instance churn", () => {
    expect(playFilesPageSource).toContain("const stopBackgroundExecutionRef = useRef(stopBackgroundExecution);");
    expect(playFilesPageSource).toContain("stopBackgroundExecutionRef.current = stopBackgroundExecution;");
    expect(playFilesPageSource).toContain("const backgroundCleanupTrackInstanceIdRef = useRef(trackInstanceId);");
    expect(playFilesPageSource).toContain("backgroundCleanupTrackInstanceIdRef.current = trackInstanceId;");
    expect(playFilesPageSource).toMatch(/void stopBackgroundExecutionRef\s*\.current\(\{/);
    expect(playFilesPageSource).toContain("trackInstanceId: backgroundCleanupTrackInstanceIdRef.current");
    expect(playFilesPageSource).toContain("void queueBackgroundDueAtUpdateRef.current(null);");
  });

  it("restores Play volume overrides on real navigation cleanup without firing on callback identity churn", () => {
    expect(playFilesPageSource).toContain(
      "const restoreVolumeOverridesOnNavigateRef = useRef(restoreVolumeOverrides);",
    );
    expect(playFilesPageSource).toContain("const navigateCleanupIsPlayingRef = useRef(isPlaying);");
    expect(playFilesPageSource).toContain("const navigateCleanupIsPausedRef = useRef(isPaused);");
    expect(playFilesPageSource).toContain("restoreVolumeOverridesOnNavigateRef.current = restoreVolumeOverrides;");
    expect(playFilesPageSource).toContain("navigateCleanupIsPlayingRef.current = isPlaying;");
    expect(playFilesPageSource).toContain("navigateCleanupIsPausedRef.current = isPaused;");
    expect(playFilesPageSource).toContain(
      "if (navigateCleanupIsPlayingRef.current || navigateCleanupIsPausedRef.current) {",
    );
    expect(playFilesPageSource).toContain(
      'void restoreVolumeOverridesOnNavigateRef.current("navigate").catch((error) => {',
    );
  });

  it("keeps previous enabled at the first track when repeat is active", () => {
    expect(playFilesPageSource).toContain("const hasPrev = hasPlaylist && (currentIndex > 0 || repeatEnabled);");
    expect(playFilesPageSource).toContain(
      "const hasNext = hasPlaylist && (currentIndex < playlist.length - 1 || repeatEnabled);",
    );
  });
});

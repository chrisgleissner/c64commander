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
    expect(playFilesPageSource).toContain("syncPlaybackTimelineRef.current({ allowAutoAdvance: false });");
    expect(playFilesPageSource).toContain("const playbackState = playbackStateRef.current;");
    expect(playFilesPageSource).toContain("if (event.dueAtMs !== guard.dueAtMs) return;");
    expect(playFilesPageSource).toContain('await handleNextRef.current("auto", expectedTrackInstanceId);');
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
    expect(playFilesPageSource).toContain("await queueBackgroundDueAtUpdateRef.current(null);");
    expect(playFilesPageSource).toContain("await queueBackgroundDueAtUpdateRef.current(nextGuard.dueAtMs);");
    expect(playFilesPageSource).toContain('addErrorLog("Failed to re-arm background auto-advance"');
    expect(playFilesPageSource).toContain('addErrorLog("Failed to register background auto-advance listener"');
  });

  it("keeps the Android background auto-skip native listener registered through volatile playback changes", () => {
    expect(playFilesPageSource).toContain("const handleNextRef = useRef(handleNext);");
    expect(playFilesPageSource).toContain("handleNextRef.current = handleNext;");
    expect(playFilesPageSource).toContain("const playbackStateRef = useRef({ isPlaying, isPaused });");
    expect(playFilesPageSource).toContain("playbackStateRef.current = { isPlaying, isPaused };");
    expect(playFilesPageSource).toContain("const syncPlaybackTimelineRef = useRef(syncPlaybackTimeline);");
    expect(playFilesPageSource).toContain("syncPlaybackTimelineRef.current = syncPlaybackTimeline;");

    const listenerEffectStart = playFilesPageSource.indexOf("const registerBackgroundAutoSkipListener = async () => {");
    const listenerEffectEnd = playFilesPageSource.indexOf(
      "const currentItem = playlist[currentIndex];",
      listenerEffectStart,
    );
    const listenerEffect = playFilesPageSource.slice(listenerEffectStart, listenerEffectEnd);
    expect(listenerEffect).not.toContain(
      "[autoAdvanceGuardRef, handleNext, isPaused, isPlaying, syncPlaybackTimeline]",
    );
    expect(listenerEffect).not.toContain("await handleNext(");
    expect(listenerEffect).not.toContain("!isPlaying || isPaused");
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

  it("classifies background-execution and HVSC lifecycle failures per ERROR_POLICY (no destructive toast for system work)", () => {
    // stopBackgroundExecution cleanup failures are system work: S0, diagnostics only.
    const stopReports = playFilesPageSource.split('operation: "stopBackgroundExecution"').length - 1;
    expect(stopReports).toBe(2);
    const backgroundFlags = playFilesPageSource.split("background: true").length - 1;
    expect(backgroundFlags).toBeGreaterThanOrEqual(2);
    // startBackgroundExecution degradation and HVSC disable-cancel failures are S2 notices.
    expect(playFilesPageSource).toMatch(/operation: "startBackgroundExecution",[\s\S]{0,400}severity: "S2",/);
    expect(playFilesPageSource).toMatch(/operation: "HVSC_CANCEL",[\s\S]{0,400}severity: "S2",/);
  });
});

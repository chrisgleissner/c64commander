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
    expect(playFilesPageSource).toContain("resolveBackgroundExecutionAction({");
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
    // Through `advanceOnTrackEnd`, not straight to `handleNext`: both automatic advances — this
    // background watchdog and the foreground timeline reconciliation — go through the one function
    // that asks the sleep timer whether that was meant to be the last tune. Calling `handleNext`
    // directly here would let the background path keep playing through a sleep timer the foreground
    // path honours.
    expect(playFilesPageSource).toContain("await advanceOnTrackEndRef.current(expectedTrackInstanceId);");
    expect(playFilesPageSource).toContain("if (sleepTimerRef.current.notifyTuneEnded()) return Promise.resolve();");
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

  it("stops background execution only on inactive cleanup, not active playback unmount or track churn", () => {
    expect(playFilesPageSource).toContain("const stopBackgroundExecutionRef = useRef(stopBackgroundExecution);");
    expect(playFilesPageSource).toContain("stopBackgroundExecutionRef.current = stopBackgroundExecution;");
    expect(playFilesPageSource).toContain("const backgroundCleanupTrackInstanceIdRef = useRef(trackInstanceId);");
    expect(playFilesPageSource).toContain("backgroundCleanupTrackInstanceIdRef.current = trackInstanceId;");
    expect(playFilesPageSource).toContain("const latestPlaybackState = playbackStateRef.current;");
    // HARD27-007: a paused session is kept alive too, so the unmount guard no longer excludes it.
    expect(playFilesPageSource).toMatch(
      /if\s*\(\s*latestPlaybackState\.isPlaying\s*\|\|\s*!hasObservedActivePlaybackRef\.current\s*\)\s*\{/m,
    );
    expect(playFilesPageSource).toContain("Leaving background playback guard active across Play page unmount");
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

  it("derives transport enablement from the same traversal helpers used by playback", () => {
    // HARD12-005: what Previous/Next look like has to be decided by the functions that decide what
    // they do, so the buttons cannot claim there is somewhere to go when the traversal disagrees.
    expect(playFilesPageSource).toMatch(/const hasPrev = canAdvancePrevious\(\s*playlist,\s*currentIndex,/);
    expect(playFilesPageSource).toMatch(/const hasNext = canAdvanceNext\(\s*playlist,\s*currentIndex,/);
  });

  it("computes transport enablement from the ordering a running station imposes, not the raw switches", () => {
    // A station turns Shuffle and Repeat off for the traversal. If the enablement kept reading the
    // raw switches, Previous could be shown as available at a position only the shuffled walk can
    // reach, and Next as available at the end of the queue because Repeat says it wraps.
    expect(playFilesPageSource).toContain(
      "const traversalOrdering = resolveTraversalOrdering({ repeatEnabled, shuffleEnabled }, sidRadio.active);",
    );
    for (const helper of ["canAdvancePrevious", "canAdvanceNext"]) {
      const call = playFilesPageSource.slice(playFilesPageSource.indexOf(`${helper}(`));
      expect(call.slice(0, 200)).toContain("traversalOrdering.repeatEnabled");
      expect(call.slice(0, 200)).toContain("traversalOrdering.shuffleEnabled");
    }
  });

  it("keeps Remote Input gated on an actually-playing session (HARD12-017)", () => {
    // The button reaches a controller for the machine that is playing. Shown while nothing plays it
    // opens a sheet with nothing to drive.
    expect(playFilesPageSource).toContain("{remoteInputEnabled && isPlaying ? (");
    expect(playFilesPageSource).toContain('data-testid="play-open-controller"');
  });

  it("places the controller actions after the two station actions", () => {
    // All of them open a sheet, so they share one wrapping row. The controller actions come last
    // because they leave the music behind, while SID Radio and Liked Tunes are about what plays
    // next and belong nearer the controls that play it.
    const launcher = playFilesPageSource.indexOf('data-testid="sid-radio-launcher"');
    const likedTunes = playFilesPageSource.indexOf('data-testid="sid-radio-liked-tunes-open"');
    const controllerRow = playFilesPageSource.indexOf("gameModeLeadsTransportRow ? (");
    expect(launcher).toBeGreaterThan(-1);
    expect(likedTunes).toBeGreaterThan(launcher);
    expect(controllerRow).toBeGreaterThan(likedTunes);
    // And it is no longer handed to the playback card, which drew it above all three.
    expect(playFilesPageSource).not.toContain("openControllerAction=");
  });

  // GM-1: a running program, cartridge or disk image is overwhelmingly likely to be a game,
  // so Game Mode leads the row there; a running tune is not, so it follows Remote Input.
  it("leads the transport row with Game Mode only for a non-song item", () => {
    const row = playFilesPageSource.slice(
      playFilesPageSource.indexOf("gameModeLeadsTransportRow ? ("),
      playFilesPageSource.indexOf("gameModeLeadsTransportRow ? (") + 400,
    );
    const leadBranch = row.slice(0, row.indexOf(") : ("));
    const followBranch = row.slice(row.indexOf(") : ("));
    expect(leadBranch.indexOf("playGameModeButton")).toBeLessThan(leadBranch.indexOf("playRemoteInputButton"));
    expect(followBranch.indexOf("playRemoteInputButton")).toBeLessThan(followBranch.indexOf("playGameModeButton"));
    expect(playFilesPageSource).toContain(
      "const gameModeLeadsTransportRow = Boolean(currentItem && !isSongCategory(currentItem.category));",
    );
  });

  it("does not overwrite playItem's resolved subsong playlist entry with the stripped switch item", () => {
    expect(playFilesPageSource).not.toMatch(
      /await playItem\(nextItem,[\s\S]{0,160}setPlaylist\(\(prev\) => prev\.map\(/,
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

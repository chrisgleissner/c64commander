import type { FeatureFlagSnapshot } from "@/lib/config/featureFlags";

type BackgroundExecutionDecision = {
  backgroundExecutionEnabled: boolean;
  backgroundExecutionActive: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  /**
   * HARD12-018: true when the last song in the playlist auto-ended and there
   * is no upcoming auto-advance due-time. The wake lock has no remaining job,
   * so background execution must stop even though `isPlaying` stays true (the
   * Stop affordance must remain available to the user).
   */
  playlistEnded?: boolean;
};

export const isBackgroundExecutionEnabled = ({ flags }: FeatureFlagSnapshot) =>
  Boolean(flags.background_execution_enabled);

export const shouldStartBackgroundExecution = ({
  backgroundExecutionEnabled,
  backgroundExecutionActive,
  isPlaying,
  isPaused,
  playlistEnded,
}: BackgroundExecutionDecision) =>
  backgroundExecutionEnabled && isPlaying && !isPaused && !backgroundExecutionActive && !playlistEnded;

export const shouldStopBackgroundExecution = ({
  backgroundExecutionEnabled,
  backgroundExecutionActive,
  isPlaying,
  isPaused,
  playlistEnded,
}: BackgroundExecutionDecision) =>
  backgroundExecutionActive && (!backgroundExecutionEnabled || !isPlaying || isPaused || Boolean(playlistEnded));

export const shouldSyncBackgroundExecutionDueAt = (
  backgroundExecutionEnabled: boolean,
  _backgroundExecutionActive: boolean,
  isNativeAndroid: boolean,
) => backgroundExecutionEnabled && isNativeAndroid;

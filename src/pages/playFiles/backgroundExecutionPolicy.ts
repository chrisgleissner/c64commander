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
  backgroundExecutionActive && (!backgroundExecutionEnabled || !isPlaying || Boolean(playlistEnded));

/**
 * HARD27-007: a plain pause no longer stops background execution, because stopping the service
 * releases the MediaSession and the headset or lock-screen Play that follows reaches nothing.
 * The session is told it is paused instead; the service drops its wake lock and keeps the
 * notification and session for a bounded grace period. Returns null when there is no live session
 * to tell.
 */
export const resolveBackgroundExecutionPaused = ({
  backgroundExecutionEnabled,
  backgroundExecutionActive,
  isPlaying,
  isPaused,
  playlistEnded,
}: BackgroundExecutionDecision): boolean | null => {
  if (!backgroundExecutionActive || !backgroundExecutionEnabled) return null;
  if (!isPlaying || playlistEnded) return null;
  return isPaused;
};

export const shouldSyncBackgroundExecutionDueAt = (
  backgroundExecutionEnabled: boolean,
  _backgroundExecutionActive: boolean,
  isNativeAndroid: boolean,
) => backgroundExecutionEnabled && isNativeAndroid;

/**
 * The single ordering of the four things a playback-state change can do to background execution.
 * The Play page and its lifecycle test both read it from here, so neither can drift from the other.
 */
export type BackgroundExecutionAction = "start" | "stop" | "publish-paused" | "publish-playing" | "none";

export const resolveBackgroundExecutionAction = (decision: BackgroundExecutionDecision): BackgroundExecutionAction => {
  if (shouldStartBackgroundExecution(decision)) return "start";
  if (shouldStopBackgroundExecution(decision)) return "stop";
  const paused = resolveBackgroundExecutionPaused(decision);
  if (paused === null) return "none";
  return paused ? "publish-paused" : "publish-playing";
};

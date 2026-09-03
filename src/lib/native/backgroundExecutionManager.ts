/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { BackgroundExecution, type NowPlayingInfo } from "@/lib/native/backgroundExecution";
import { ensureNotificationPermission } from "@/lib/native/notificationPermission";
import { getLifecycleState } from "@/lib/appLifecycle";
import { classifyError } from "@/lib/tracing/failureTaxonomy";

type BackgroundExecutionLogContext = {
  source: string;
  reason?: string;
  context?: Record<string, unknown>;
};

let activeCount = 0;
let publishedPaused = false;
/** The last tune the page named, whether or not a session existed to tell at the time. */
let currentNowPlaying: NowPlayingInfo | null = null;
/** The last tune the bridge accepted, so an unchanged track costs no bridge call. */
let publishedNowPlaying: NowPlayingInfo | null = null;

const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

const buildFailureDetails = (error: unknown, logContext: BackgroundExecutionLogContext) => {
  const failure = classifyError(error);
  const normalizedError = toError(error);
  return {
    ...logContext,
    lifecycleState: getLifecycleState(),
    failureClass: failure.failureClass,
    failureCategory: failure.category,
    error: normalizedError.message,
  };
};

const buildOperationError = (operation: "start" | "stop" | "playback-state" | "now-playing", error: unknown) => {
  const normalizedError = toError(error);
  return new Error(`Background execution ${operation} failed: ${normalizedError.message}`);
};

const sameNowPlaying = (left: NowPlayingInfo | null, right: NowPlayingInfo | null) =>
  left?.title === right?.title && left?.artist === right?.artist && left?.durationMs === right?.durationMs;

/**
 * Hands the current tune to the native session. Separated from the page-facing entry point because
 * a start has to publish it too: the page names the tune in the same commit that starts playback,
 * which is before the foreground service exists to be told.
 */
const publishNowPlaying = async (logContext: BackgroundExecutionLogContext) => {
  if (!currentNowPlaying) return;
  if (sameNowPlaying(currentNowPlaying, publishedNowPlaying)) return;
  const previouslyPublished = publishedNowPlaying;
  const info = currentNowPlaying;
  publishedNowPlaying = info;
  try {
    await BackgroundExecution.setNowPlaying(info);
  } catch (error) {
    // A failed publish must stay retryable, or the dedupe above would swallow the next attempt.
    publishedNowPlaying = previouslyPublished;
    addLog("error", "Background execution now-playing update failed", buildFailureDetails(error, logContext));
    throw buildOperationError("now-playing", error);
  }
};

export const startBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  activeCount += 1;
  if (activeCount > 1) return;
  publishedPaused = false;
  publishedNowPlaying = null;
  // Ask before the service starts: startForeground() posts the notification once, and a grant that
  // arrives afterwards does not bring back a notification the system has already dropped.
  await ensureNotificationPermission();
  try {
    await BackgroundExecution.start();
  } catch (error) {
    activeCount = Math.max(0, activeCount - 1);
    addLog("error", "Background execution start failed", buildFailureDetails(error, logContext));
    throw buildOperationError("start", error);
  }
  // Best effort: the session is running and playing either way, and a lock screen that names the
  // wrong thing is not a reason to fail the start the user asked for.
  await publishNowPlaying(logContext).catch(() => undefined);
};

export const stopBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  if (activeCount <= 0) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  publishedPaused = false;
  currentNowPlaying = null;
  publishedNowPlaying = null;
  try {
    await BackgroundExecution.stop();
  } catch (error) {
    addLog("error", "Background execution stop failed", buildFailureDetails(error, logContext));
    throw buildOperationError("stop", error);
  }
};

/**
 * Publishes whether the live session is playing or paused. A paused session keeps its foreground
 * notification and MediaSession for a bounded grace period, so a headset or lock-screen Play still
 * reaches the web layer (HARD27-007). No session, nothing to publish.
 */
export const setBackgroundExecutionPaused = async (paused: boolean, logContext: BackgroundExecutionLogContext) => {
  if (activeCount <= 0) return;
  // The page recomputes this on every playback-state change, most of which do not move the
  // playing/paused boundary. Only a real transition is worth a bridge call.
  if (paused === publishedPaused) return;
  const previouslyPublished = publishedPaused;
  publishedPaused = paused;
  try {
    await BackgroundExecution.setPlaybackState({ paused });
  } catch (error) {
    // A failed publish must stay retryable, or the dedupe above would swallow the next attempt.
    publishedPaused = previouslyPublished;
    addLog("error", "Background execution playback state update failed", buildFailureDetails(error, logContext));
    throw buildOperationError("playback-state", error);
  }
};

/**
 * Publishes what is playing, so the lock-screen media control names the tune and its transport
 * buttons act on a session the user can see (HARD27-040). Remembered even without a live session,
 * because the page names the track in the commit that starts one.
 */
export const setBackgroundExecutionNowPlaying = async (
  info: NowPlayingInfo,
  logContext: BackgroundExecutionLogContext,
) => {
  currentNowPlaying = info;
  if (activeCount <= 0) return;
  await publishNowPlaying(logContext);
};

export const resetBackgroundExecutionState = () => {
  activeCount = 0;
  publishedPaused = false;
  currentNowPlaying = null;
  publishedNowPlaying = null;
};

// True while this JS manager believes background execution is active. The Play
// page uses this so a remounted instance adopts the existing session instead of
// issuing a second `start` (which would unbalance the reference count and leak
// the wake lock after Stop — see BUG-025).
export const isBackgroundExecutionActive = () => activeCount > 0;

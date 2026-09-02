/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { BackgroundExecution } from "@/lib/native/backgroundExecution";
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

const buildOperationError = (operation: "start" | "stop" | "playback-state", error: unknown) => {
  const normalizedError = toError(error);
  return new Error(`Background execution ${operation} failed: ${normalizedError.message}`);
};

export const startBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  activeCount += 1;
  if (activeCount > 1) return;
  publishedPaused = false;
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
};

export const stopBackgroundExecution = async (logContext: BackgroundExecutionLogContext) => {
  if (activeCount <= 0) return;
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;
  publishedPaused = false;
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

export const resetBackgroundExecutionState = () => {
  activeCount = 0;
  publishedPaused = false;
};

// True while this JS manager believes background execution is active. The Play
// page uses this so a remounted instance adopts the existing session instead of
// issuing a second `start` (which would unbalance the reference count and leak
// the wake lock after Stop — see BUG-025).
export const isBackgroundExecutionActive = () => activeCount > 0;

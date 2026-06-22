import { isExpectedCancellationFailure } from "@/lib/diagnostics/healthModel";
import type { TraceEvent } from "@/lib/tracing/types";

type PlaybackSessionIndexState = {
  playbackSession?: {
    currentItemId?: string | null;
    currentIndex?: number | null;
  } | null;
  playlistItemIds?: string[] | null;
  currentTrack?: string | null;
};

export const computeCircularAdvanceDelta = (beforeIndex: number, afterIndex: number, playlistCount: number) => {
  if (!Number.isInteger(playlistCount) || playlistCount <= 0) {
    return afterIndex - beforeIndex;
  }
  return (afterIndex - beforeIndex + playlistCount) % playlistCount;
};

export const computeCircularRetreatDelta = (beforeIndex: number, afterIndex: number, playlistCount: number) => {
  if (!Number.isInteger(playlistCount) || playlistCount <= 0) {
    return beforeIndex - afterIndex;
  }
  return (beforeIndex - afterIndex + playlistCount) % playlistCount;
};

export const computeCircularStepDistance = (beforeIndex: number, afterIndex: number, playlistCount: number) => {
  const forward = computeCircularAdvanceDelta(beforeIndex, afterIndex, playlistCount);
  const backward = computeCircularRetreatDelta(beforeIndex, afterIndex, playlistCount);
  return Math.min(Math.abs(forward), Math.abs(backward));
};

const isInteger = (value: unknown): value is number => Number.isInteger(value);

export const resolvePlaylistIndexFromState = (state: PlaybackSessionIndexState): number => {
  const currentIndex = state?.playbackSession?.currentIndex;
  if (isInteger(currentIndex)) return currentIndex;

  const currentItemId = state?.playbackSession?.currentItemId ?? null;
  const playlistItemIds = Array.isArray(state?.playlistItemIds) ? state.playlistItemIds : [];
  if (currentItemId && playlistItemIds.length) {
    const derivedIndex = playlistItemIds.indexOf(currentItemId);
    if (derivedIndex >= 0) return derivedIndex;
  }
  return -1;
};

export const hasPlaylistSelectionChanged = (
  beforeState: PlaybackSessionIndexState,
  afterState: PlaybackSessionIndexState,
) => {
  const beforeItemId = beforeState?.playbackSession?.currentItemId ?? null;
  const afterItemId = afterState?.playbackSession?.currentItemId ?? null;
  if (beforeItemId && afterItemId && beforeItemId !== afterItemId) {
    return true;
  }

  const beforeIndex = resolvePlaylistIndexFromState(beforeState);
  const afterIndex = resolvePlaylistIndexFromState(afterState);
  if (beforeIndex >= 0 && afterIndex >= 0 && beforeIndex !== afterIndex) {
    return true;
  }

  const beforeTrack = beforeState?.currentTrack ?? null;
  const afterTrack = afterState?.currentTrack ?? null;
  return Boolean(beforeTrack && afterTrack && beforeTrack !== afterTrack);
};

export const isActionableSoakTraceError = (event: TraceEvent<Record<string, unknown>> | null | undefined) => {
  if (event?.type !== "error") return false;
  if (event.origin === "system") return false;
  if (event.data.expectedFailure === true) return false;
  return !isExpectedCancellationFailure(event);
};

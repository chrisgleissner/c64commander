/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useDebouncedValue } from "@/pages/playFiles/hooks/useDebouncedValue";
import { loadDefaultSongDurationMs, saveDefaultSongDurationMs } from "@/lib/config/appSettings";
import type { PlaylistItem } from "@/pages/playFiles/types";
import {
  DEFAULT_SONG_DURATION_MS,
  applyDurationOverrideToPlaylist,
  clampDurationSeconds,
  formatDurationSeconds,
  normalizeDurationInputDraft,
  parseDurationInput,
  sliderToDurationSeconds,
} from "@/pages/playFiles/playFilesUtils";

export const useDurationOverride = (
  setPlaylist: Dispatch<SetStateAction<PlaylistItem[]>>,
  setDurationMs: Dispatch<SetStateAction<number | undefined>>,
) => {
  const [pendingDurationOverrideMs, setPendingDurationOverrideMs] = useState<number | undefined>(undefined);
  const debouncedDurationOverrideMs = useDebouncedValue(pendingDurationOverrideMs, 500);
  const [durationSeconds, setDurationSeconds] = useState(() =>
    Math.round(loadDefaultSongDurationMs(DEFAULT_SONG_DURATION_MS) / 1000),
  );
  const [durationInput, setDurationInput] = useState(() => formatDurationSeconds(durationSeconds));

  const persistDurationOverride = useCallback(
    (durationOverrideMs: number) => {
      saveDefaultSongDurationMs(durationOverrideMs);
      setPlaylist((prev) => applyDurationOverrideToPlaylist(prev, durationOverrideMs));
    },
    [setPlaylist],
  );

  useEffect(() => {
    if (debouncedDurationOverrideMs === undefined) return;
    persistDurationOverride(debouncedDurationOverrideMs);
  }, [debouncedDurationOverrideMs, persistDurationOverride]);

  const handleDurationSliderChange = useCallback(
    (value: number[]) => {
      const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setPendingDurationOverrideMs(nextDurationMs);
      setDurationInput(formatDurationSeconds(nextSeconds));
    },
    [setDurationMs],
  );

  const handleDurationSliderCommit = useCallback(
    (value: number[]) => {
      const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setDurationInput(formatDurationSeconds(nextSeconds));
      persistDurationOverride(nextDurationMs);
      setPendingDurationOverrideMs(undefined);
    },
    [persistDurationOverride, setDurationMs],
  );

  const handleDurationInputChange = useCallback(
    (value: string) => {
      const normalizedValue = normalizeDurationInputDraft(value);
      setDurationInput(normalizedValue);
      const parsed = parseDurationInput(normalizedValue);
      if (parsed === undefined) return;
      const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setPendingDurationOverrideMs(nextDurationMs);
    },
    [setDurationMs],
  );

  const handleDurationInputBlur = useCallback(() => {
    const parsed = parseDurationInput(durationInput);
    if (parsed === undefined) {
      setDurationInput(formatDurationSeconds(durationSeconds));
      return;
    }
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    const nextDurationMs = nextSeconds * 1000;
    setDurationSeconds(nextSeconds);
    setDurationMs(nextDurationMs);
    persistDurationOverride(nextDurationMs);
    setPendingDurationOverrideMs(undefined);
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, [durationInput, durationSeconds, persistDurationOverride, setDurationMs]);

  return {
    pendingDurationOverrideMs,
    durationSeconds,
    durationInput,
    handleDurationSliderChange,
    handleDurationSliderCommit,
    handleDurationInputChange,
    handleDurationInputBlur,
  };
};

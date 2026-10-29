/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useEffect, useState } from "react";

import { usePageActivity } from "@/hooks/usePageActivity";
import { readSpectrum, setSpectrumDemand } from "@/lib/native/audioFx";
import { foldBands, levelToUnit } from "@/lib/audio/spectrum/spectrumBands";

export const BACKDROP_OWNER = "sound-card";
export const BACKDROP_BANDS = 24;
export const BACKDROP_INTERVAL_MS = 120;
const SMOOTHING = 0.45;

const useDocumentShowing = () => {
  const [showing, setShowing] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const update = () => setShowing(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return showing;
};

/**
 * A slow, smoothed copy of the live spectrum for the tone curve's backdrop, as levels from 0 to 1. It asks
 * for the analyser only while `wanted`, the page is on screen and the app is showing, and is null otherwise.
 */
export const useSpectrumBackdrop = (wanted: boolean): readonly number[] | null => {
  const onScreen = usePageActivity();
  const showing = useDocumentShowing();
  const running = wanted && onScreen && showing;
  const [levels, setLevels] = useState<readonly number[] | null>(null);

  useEffect(() => {
    if (!running) {
      setLevels(null);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const folded = new Float32Array(BACKDROP_BANDS);
    const smooth = new Float32Array(BACKDROP_BANDS);
    void setSpectrumDemand(BACKDROP_OWNER, true);
    const tick = async () => {
      const frame = await readSpectrum();
      if (cancelled) return;
      if (frame?.active && frame.bands.length % BACKDROP_BANDS === 0) {
        foldBands(frame.bands, folded);
        for (let i = 0; i < BACKDROP_BANDS; i += 1) smooth[i] += (levelToUnit(folded[i]) - smooth[i]) * SMOOTHING;
        setLevels(Array.from(smooth));
      } else {
        setLevels(null);
      }
      timer = setTimeout(() => void tick(), BACKDROP_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      void setSpectrumDemand(BACKDROP_OWNER, false);
    };
  }, [running]);

  return running ? levels : null;
};

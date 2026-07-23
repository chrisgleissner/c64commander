/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";
import {
  FIT_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  panViewport,
  setCenter,
  zoomViewport,
  type Viewport,
} from "@/lib/streams/mirrorViewport";
import { MotionTracker } from "@/lib/streams/motionTracker";

const FOLLOW_EASE = 0.28;
const FOLLOW_MIN_INTERVAL_MS = 80; // cap follow re-centres to ~12/s
const MANUAL_FOLLOW_PAUSE_MS = 1500; // manual pan/zoom wins for a moment
const FOLLOW_MIN_SCALE = 1.05; // never follow when essentially fit

export interface UseMirrorViewportOptions {
  session?: AvMirrorSession;
  follow?: boolean;
}

/**
 * Viewport (zoom/pan) state for the immersive mirror, plus continuous "smart follow":
 * when enabled, the viewport eases toward on-screen activity (e.g. the cursor while
 * typing), debounced so a manual pan/zoom always wins briefly. All math is delegated
 * to the pure `mirrorViewport` / `motionTracker` modules.
 */
export const useMirrorViewport = ({ session = avMirrorSession, follow = false }: UseMirrorViewportOptions = {}) => {
  const [viewport, setViewport] = useState<Viewport>(FIT_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const manualPauseUntilRef = useRef(0);
  const lastFollowAtRef = useRef(0);
  const trackerRef = useRef<MotionTracker | null>(null);

  const markManual = () => {
    manualPauseUntilRef.current = Date.now() + MANUAL_FOLLOW_PAUSE_MS;
  };

  const zoomBy = useCallback((factor: number, focus?: { x: number; y: number }) => {
    markManual();
    setViewport((v) => zoomViewport(v, factor, focus));
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    markManual();
    setViewport((v) => panViewport(v, dx, dy));
  }, []);

  const centerOn = useCallback((cx: number, cy: number) => {
    markManual();
    setViewport((v) => setCenter(v, cx, cy));
  }, []);

  const setScale = useCallback((scale: number) => {
    markManual();
    setViewport((v) => zoomViewport(v, Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) / v.scale));
  }, []);

  const reset = useCallback(() => {
    markManual();
    setViewport(FIT_VIEWPORT);
  }, []);

  // Smart follow: run the motion tracker on the shared frames and ease toward activity.
  useEffect(() => {
    if (!follow) {
      trackerRef.current = null;
      return;
    }
    const tracker = new MotionTracker();
    trackerRef.current = tracker;
    const unsubscribe = session.subscribeFrames((frame, height = VIC_PAL_HEIGHT) => {
      const result = tracker.update(frame, VIC_FRAME_WIDTH, height);
      if (!result.changed || !result.centroid) return;
      const now = Date.now();
      if (now < manualPauseUntilRef.current) return;
      if (now - lastFollowAtRef.current < FOLLOW_MIN_INTERVAL_MS) return;
      if (viewportRef.current.scale < FOLLOW_MIN_SCALE) return;
      lastFollowAtRef.current = now;
      const target = result.centroid;
      setViewport((v) => setCenter(v, v.cx + (target.x - v.cx) * FOLLOW_EASE, v.cy + (target.y - v.cy) * FOLLOW_EASE));
    });
    return () => {
      unsubscribe();
      trackerRef.current = null;
    };
  }, [follow, session]);

  return useMemo(
    () => ({ viewport, zoomBy, panBy, centerOn, setScale, reset }),
    [viewport, zoomBy, panBy, centerOn, setScale, reset],
  );
};

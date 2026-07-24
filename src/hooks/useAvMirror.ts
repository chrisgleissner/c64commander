/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { avMirrorSession, type AvMirrorSession, type AvMirrorSnapshot } from "@/lib/streams/avMirrorSession";
import { buildPaletteLUT, decodeVicFrameInto, VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";

const isLive = (state: string) => state === "connecting" || state === "live";

/**
 * React binding for the shared A/V mirror session. Every surface uses this so the
 * mirror is controlled from one place and never duplicated.
 */
export const useAvMirror = (session: AvMirrorSession = avMirrorSession) => {
  const [snapshot, setSnapshot] = useState<AvMirrorSnapshot>(() => session.getSnapshot());
  useEffect(() => session.subscribe(setSnapshot), [session]);

  const toggleAudio = useCallback(() => session.toggleAudio(), [session]);
  const toggleVideo = useCallback(() => session.toggleVideo(), [session]);
  const stopAll = useCallback(() => session.stopAll(), [session]);

  return useMemo(
    () => ({
      audio: snapshot.audio,
      video: snapshot.video,
      audioLive: isLive(snapshot.audio.state),
      videoLive: isLive(snapshot.video.state),
      anyLive: isLive(snapshot.audio.state) || isLive(snapshot.video.state),
      toggleAudio,
      toggleVideo,
      stopAll,
      session,
    }),
    [snapshot, toggleAudio, toggleVideo, stopAll, session],
  );
};

/**
 * Decode the shared session's video frames into a canvas (fixed-cost LUT decode +
 * one putImageData; the canvas re-sizes for PAL 272 / NTSC 240). Any number of
 * canvases can subscribe — they all render the one stream.
 */
export const useAvMirrorCanvas = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  session: AvMirrorSession = avMirrorSession,
) => {
  const lutRef = useRef<Uint32Array | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const pixelsRef = useRef<Uint32Array | null>(null);
  const heightRef = useRef<number>(0);

  useEffect(() => {
    return session.subscribeFrames((frame, height = VIC_PAL_HEIGHT) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return; // jsdom / no-canvas: no-op
      if (!lutRef.current) lutRef.current = buildPaletteLUT();
      if (!imageDataRef.current || !pixelsRef.current || heightRef.current !== height) {
        canvas.height = height;
        imageDataRef.current = ctx.createImageData(VIC_FRAME_WIDTH, height);
        pixelsRef.current = new Uint32Array(imageDataRef.current.data.buffer);
        heightRef.current = height;
      }
      decodeVicFrameInto(frame, pixelsRef.current, lutRef.current);
      ctx.putImageData(imageDataRef.current, 0, 0);
    });
  }, [canvasRef, session]);
};

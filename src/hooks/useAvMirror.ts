/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { avMirrorSession, type AvMirrorSession, type AvMirrorSnapshot } from "@/lib/streams/avMirrorSession";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";
import { VicFramePainter } from "@/lib/streams/vicFramePainter";
import { activeVicPaletteLut, subscribeVicPalette } from "@/lib/streams/vicPalette";
import { usePageActivity } from "@/hooks/usePageActivity";

const isLive = (state: string) => state === "connecting" || state === "live";

/** The fields surfaces show. The session also publishes packet and frame counters about ten times a second. */
const SHOWN_FIELDS = ["state", "error", "senderMismatch", "foreignSenderNotice", "reconnecting"] as const;
const FRAME_RATE_FIELDS = [...SHOWN_FIELDS, "fps", "standard"] as const;

const showsTheSame = (fields: readonly string[], a: AvMirrorSnapshot, b: AvMirrorSnapshot) =>
  (["audio", "video"] as const).every((stream) =>
    fields.every(
      (field) => (a[stream] as Record<string, unknown>)[field] === (b[stream] as Record<string, unknown>)[field],
    ),
  );

/**
 * React binding for the shared A/V mirror session. Every surface uses this so the
 * mirror is controlled from one place and never duplicated.
 *
 * A surface re-renders when something it can show changes, so the counters in `audio` and `video` may be older
 * than the session's; read those from the session itself. Only a surface that shows the frame-rate badge asks for
 * `frameRate`, which also re-renders it as the rate moves.
 */
export const useAvMirror = (session: AvMirrorSession = avMirrorSession, options: { frameRate?: boolean } = {}) => {
  const fields = options.frameRate ? FRAME_RATE_FIELDS : SHOWN_FIELDS;
  const [snapshot, setSnapshot] = useState<AvMirrorSnapshot>(() => session.getSnapshot());
  useEffect(
    () => session.subscribe((next) => setSnapshot((shown) => (showsTheSame(fields, shown, next) ? shown : next))),
    [session, fields],
  );

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
      videoReconnecting: snapshot.video.reconnecting === true,
      anyStoppable: snapshot.audio.state !== "off" || snapshot.video.state !== "off",
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
  const paintedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const painterRef = useRef<VicFramePainter | null>(null);
  painterRef.current ??= new VicFramePainter();

  // A page kept mounted behind the one on screen does not paint. Subscribing again when it is shown
  // replays the latest frame, so it is painted in full before the next one arrives.
  const pageActive = usePageActivity();
  useEffect(() => {
    if (!pageActive) return;
    painterRef.current?.invalidate();
    return session.subscribeFrames((frame, height = VIC_PAL_HEIGHT) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return; // jsdom / no-canvas: no-op
      const painter = painterRef.current!;
      // Cached table, never built here: a palette change swaps it in via the subscription below,
      // so the per-pixel decode is byte-for-byte what it was before palettes were selectable.
      if (!lutRef.current) lutRef.current = activeVicPaletteLut();
      if (paintedCanvasRef.current !== canvas) {
        paintedCanvasRef.current = canvas;
        painter.invalidate();
      }
      if (!imageDataRef.current || !pixelsRef.current || heightRef.current !== height) {
        canvas.height = height;
        imageDataRef.current = ctx.createImageData(VIC_FRAME_WIDTH, height);
        pixelsRef.current = new Uint32Array(imageDataRef.current.data.buffer);
        heightRef.current = height;
        painter.invalidate();
      }
      const painted = painter.paint(frame, height, pixelsRef.current, lutRef.current);
      if (painted) {
        ctx.putImageData(imageDataRef.current, 0, 0, 0, painted.firstLine, VIC_FRAME_WIDTH, painted.lineCount);
      }
    });
  }, [canvasRef, pageActive, session]);

  // Only changed lines are painted, so canvas content the browser discarded (a lost 2D context, or a WebView that
  // dropped its backing store in the background) would stay blank over a still C64 screen. Paint the next frame whole.
  useEffect(() => {
    const repaintWhole = () => painterRef.current?.invalidate();
    const canvas = canvasRef.current;
    canvas?.addEventListener("contextrestored", repaintWhole);
    document.addEventListener("visibilitychange", repaintWhole);
    return () => {
      canvas?.removeEventListener("contextrestored", repaintWhole);
      document.removeEventListener("visibilitychange", repaintWhole);
    };
  }, [canvasRef]);

  // Picking a different palette swaps the cached table in. Separate from the frame subscription on
  // purpose: the frame handler must not check for a palette change, or the check would run 50 times
  // a second forever to catch something that happens when a user opens Settings.
  useEffect(
    () =>
      subscribeVicPalette(() => {
        lutRef.current = activeVicPaletteLut();
        painterRef.current?.invalidate();
      }),
    [],
  );
};

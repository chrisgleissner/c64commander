/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getC64API } from "@/lib/c64api";
import { loadStreamVideoPort } from "@/lib/config/appSettings";
import { createStreamReceiver } from "@/lib/streams/streamReceiver";
import {
  VideoMirrorController,
  type VideoMirrorSnapshot,
  type VideoMirrorDeps,
} from "@/lib/streams/videoMirrorController";
import { buildPaletteLUT, decodeVicFrameInto, VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";

const INITIAL: VideoMirrorSnapshot = { state: "off", fps: 0, droppedPackets: 0, error: null };

export interface UseVideoMirrorOptions {
  /** Test/host seam for injecting a receiver. */
  createReceiver?: VideoMirrorDeps["createReceiver"];
  /** Render every Nth assembled frame (default 1 = every frame). CPU budget knob. */
  frameThrottle?: number;
  /** Canvas the hook decodes frames into (fixed-cost 384×272 + GPU integer scale). */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  /** Override the frame sink entirely (bypasses the canvas decode path). */
  renderFrame?: (frame: Uint8Array) => void;
  /** Injectable clock for the rolling fps window (tests). */
  now?: () => number;
}

/**
 * Content Explorer capability E — React binding for the Video Mirror controller.
 * Starts/stops the device video stream and decodes each rendered frame into the
 * supplied canvas (fixed-cost LUT decode + one putImageData); cleans up on unmount.
 */
export const useVideoMirror = (options: UseVideoMirrorOptions = {}) => {
  const [snapshot, setSnapshot] = useState<VideoMirrorSnapshot>(INITIAL);
  const controllerRef = useRef<VideoMirrorController | null>(null);

  // Decode scratch, built lazily once a real 2d context exists.
  const lutRef = useRef<Uint32Array | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const pixelsRef = useRef<Uint32Array | null>(null);
  const heightRef = useRef<number>(0);

  const { canvasRef, renderFrame: renderFrameOverride } = options;

  const renderFrame = useCallback(
    (frame: Uint8Array, height: number = VIC_PAL_HEIGHT) => {
      if (renderFrameOverride) {
        renderFrameOverride(frame);
        return;
      }
      const canvas = canvasRef?.current;
      if (!canvas) return;
      // jsdom (and any environment without canvas support) returns null here — no-op.
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (!lutRef.current) lutRef.current = buildPaletteLUT();
      // (Re)allocate the ImageData when the detected format height changes (PAL 272 /
      // NTSC 240) so an NTSC frame isn't stretched into a PAL-sized surface.
      if (!imageDataRef.current || !pixelsRef.current || heightRef.current !== height) {
        canvas.height = height;
        imageDataRef.current = ctx.createImageData(VIC_FRAME_WIDTH, height);
        pixelsRef.current = new Uint32Array(imageDataRef.current.data.buffer);
        heightRef.current = height;
      }
      decodeVicFrameInto(frame, pixelsRef.current, lutRef.current);
      ctx.putImageData(imageDataRef.current, 0, 0);
    },
    [canvasRef, renderFrameOverride],
  );

  // Keep the controller's frame sink pointing at the latest decode closure.
  const renderFrameRef = useRef(renderFrame);
  renderFrameRef.current = renderFrame;

  const getController = useCallback(() => {
    if (!controllerRef.current) {
      const api = getC64API();
      controllerRef.current = new VideoMirrorController({
        startStream: (name, destination) => api.startStream(name, destination),
        stopStream: (name) => api.stopStream(name),
        onChange: setSnapshot,
        // Inject the configured video port unless a test supplies its own receiver.
        createReceiver:
          options.createReceiver ?? ((opts) => createStreamReceiver({ ...opts, port: loadStreamVideoPort() })),
        renderFrame: (frame, height) => renderFrameRef.current(frame, height),
        frameThrottle: options.frameThrottle,
        now: options.now,
      });
    }
    return controllerRef.current;
  }, [options.createReceiver, options.frameThrottle, options.now]);

  const start = useCallback(() => getController().start(), [getController]);
  const stop = useCallback(() => getController().stop(), [getController]);

  useEffect(
    () => () => {
      void controllerRef.current?.stop();
    },
    [],
  );

  return { ...snapshot, start, stop };
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useAvMirror, useAvMirrorCanvas } from "@/hooks/useAvMirror";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

export type AvMirrorPreviewSize = "check" | "immersive";

export interface AvMirrorPreviewProps {
  /** "check" = small, high-level image; "immersive" = large, for games/keyboard control. */
  size?: AvMirrorPreviewSize;
  session?: AvMirrorSession;
  className?: string;
}

/**
 * Renders the shared video stream to a native-res (384×272) canvas, GPU integer-scaled
 * so CPU cost is fixed regardless of display size. Any number of previews can mount —
 * they all render the one shared stream (a Home "check" and the Remote Input preview).
 */
export function AvMirrorPreview({ size = "check", session, className }: AvMirrorPreviewProps) {
  const { videoLive, video } = useAvMirror(session);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useAvMirrorCanvas(canvasRef, session);

  const sizeClass = size === "immersive" ? "max-w-[640px]" : "max-w-[220px]";
  const overlay =
    video.state === "error" ? "Video unavailable" : video.state === "connecting" ? "Connecting…" : "Not watching";

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-md border border-border bg-black", sizeClass, className)}
      data-testid="av-mirror-preview"
      data-size={size}
    >
      <canvas
        ref={canvasRef}
        width={384}
        height={272}
        className="block w-full"
        style={{ imageRendering: "pixelated", aspectRatio: "384 / 272" }}
        data-testid="av-mirror-canvas"
      />
      {!videoLive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-white/70">
          {overlay}
        </div>
      )}
      {videoLive && video.fps > 0 && (
        <span
          className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] leading-tight text-white/80"
          data-testid="av-mirror-fps"
        >
          {video.standard ?? "PAL"} {video.fps} fps
        </span>
      )}
    </div>
  );
}

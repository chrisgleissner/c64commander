/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef } from "react";
import { Monitor, MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVideoMirror, type UseVideoMirrorOptions } from "@/hooks/useVideoMirror";
import { VIC_FRAME_WIDTH, VIC_FRAME_HEIGHT } from "@/lib/streams/vicDecode";
import type { VideoMirrorState } from "@/lib/streams/videoMirrorController";

const STATE_LABEL: Record<VideoMirrorState, string> = {
  off: "Off",
  connecting: "Connecting…",
  live: "Live",
  error: "Error",
};

const STATE_VARIANT: Record<VideoMirrorState, "secondary" | "default" | "destructive" | "outline"> = {
  off: "secondary",
  connecting: "outline",
  live: "default",
  error: "destructive",
};

export interface VideoMirrorPanelProps {
  /** Test/host seam for injecting a receiver / render sink / throttle. */
  mirrorOptions?: Omit<UseVideoMirrorOptions, "canvasRef">;
}

/**
 * Content Explorer capability E — Video Mirror control. Start/stop the device
 * video stream and watch it in-app on a native-resolution 384×272 canvas that the
 * GPU integer-scales (`image-rendering: pixelated`), so CPU cost is independent of
 * display size.
 *
 * Behind the `video_mirror_enabled` flag (default-off / developer_only, mounted by
 * the host surface) and CPU-budgeted per docs/plans/content-explorer/04-live-mirror.md:
 * video is the expensive Live Mirror capability, so it is never started unless the
 * flag is on, and rendering is frame-throttleable.
 */
export function VideoMirrorPanel({ mirrorOptions }: VideoMirrorPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, fps, droppedPackets, error, start, stop } = useVideoMirror({ ...mirrorOptions, canvasRef });
  const running = state === "connecting" || state === "live";

  return (
    <div className="rounded-lg border border-border p-4" data-testid="video-mirror-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {state === "live" ? (
            <Monitor className="h-5 w-5 text-primary" aria-hidden />
          ) : (
            <MonitorOff className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">Video Mirror</span>
          <Badge variant={STATE_VARIANT[state]} data-testid="video-mirror-state">
            {STATE_LABEL[state]}
          </Badge>
          {state === "live" && (
            <span className="text-xs text-muted-foreground" data-testid="video-mirror-fps">
              {fps} fps
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant={running ? "outline" : "default"}
          onClick={() => (running ? void stop() : void start())}
          data-testid="video-mirror-toggle"
        >
          {running ? "Stop" : "Watch"}
        </Button>
      </div>

      <div
        className="relative mt-3 w-full overflow-hidden rounded-md bg-black"
        style={{ maxWidth: VIC_FRAME_WIDTH * 2 }}
      >
        <canvas
          ref={canvasRef}
          width={VIC_FRAME_WIDTH}
          height={VIC_FRAME_HEIGHT}
          data-testid="video-mirror-canvas"
          className="block w-full"
          style={{ imageRendering: "pixelated", aspectRatio: `${VIC_FRAME_WIDTH} / ${VIC_FRAME_HEIGHT}` }}
        />
        {state !== "live" && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
            data-testid="video-mirror-overlay"
          >
            {state === "connecting" ? "Connecting…" : "Not connected"}
          </div>
        )}
      </div>

      {state === "live" && droppedPackets > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="video-mirror-dropped">
          {droppedPackets} dropped packet{droppedPackets === 1 ? "" : "s"}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert" data-testid="video-mirror-error">
          {error}
        </p>
      )}
    </div>
  );
}

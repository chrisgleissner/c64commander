/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Volume2, VolumeX, Tv, TvMinimal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvMirror } from "@/hooks/useAvMirror";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

/** A subtle pulsing "live" dot, so an active-but-invisible stream isn't ambiguous. */
export const LiveDot = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={cn(
      "inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px] shadow-emerald-500/30",
      className,
    )}
  />
);

export interface AvMirrorControlsProps {
  showAudio?: boolean;
  showVideo?: boolean;
  size?: "sm" | "default";
  session?: AvMirrorSession;
  className?: string;
}

/**
 * Compact Audio + Video toggles for the shared A/V mirror session. Reused on every
 * surface (Home, Remote Input, Play, Disks) so control is never duplicated. Each
 * button lights up and shows a live dot while its stream is running.
 */
export function AvMirrorControls({
  showAudio = true,
  showVideo = true,
  size = "sm",
  session,
  className,
}: AvMirrorControlsProps) {
  const { audioLive, videoLive, audio, video, toggleAudio, toggleVideo } = useAvMirror(session);
  const error = audio.error ?? video.error;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="av-mirror-controls">
      {showAudio && (
        <Button
          size={size}
          variant={audioLive ? "default" : "outline"}
          aria-pressed={audioLive}
          onClick={() => void toggleAudio()}
          data-testid="av-audio-toggle"
          data-state={audio.state}
        >
          {audioLive ? (
            <Volume2 className="mr-1.5 h-4 w-4" aria-hidden />
          ) : (
            <VolumeX className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {audio.state === "connecting" ? "Connecting…" : audioLive ? "Listening" : "Listen"}
          {audioLive && <LiveDot className="ml-1.5" />}
        </Button>
      )}
      {showVideo && (
        <Button
          size={size}
          variant={videoLive ? "default" : "outline"}
          aria-pressed={videoLive}
          onClick={() => void toggleVideo()}
          data-testid="av-video-toggle"
          data-state={video.state}
        >
          {videoLive ? (
            <Tv className="mr-1.5 h-4 w-4" aria-hidden />
          ) : (
            <TvMinimal className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {video.state === "connecting" ? "Connecting…" : videoLive ? "Watching" : "Watch"}
          {videoLive && <LiveDot className="ml-1.5" />}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive" data-testid="av-mirror-error">
          {error}
        </span>
      )}
    </div>
  );
}

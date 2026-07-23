/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAudioMirror, type UseAudioMirrorOptions } from "@/hooks/useAudioMirror";
import type { AudioMirrorState } from "@/lib/streams/audioMirrorController";

const STATE_LABEL: Record<AudioMirrorState, string> = {
  off: "Off",
  connecting: "Connecting…",
  live: "Live",
  error: "Error",
};

const STATE_VARIANT: Record<AudioMirrorState, "secondary" | "default" | "destructive" | "outline"> = {
  off: "secondary",
  connecting: "outline",
  live: "default",
  error: "destructive",
};

export interface AudioMirrorPanelProps {
  /** Test/host seam for injecting a receiver/player. */
  mirrorOptions?: UseAudioMirrorOptions;
}

/**
 * Content Explorer capability D — Audio Mirror control. Start/stop the device
 * audio stream and hear it in-app, with a connection state and dropped-packet
 * health. Behind the audio_mirror_enabled flag (mounted by the host surface).
 */
export function AudioMirrorPanel({ mirrorOptions }: AudioMirrorPanelProps) {
  const { state, droppedPackets, error, start, stop } = useAudioMirror(mirrorOptions);
  const running = state === "connecting" || state === "live";

  return (
    <div className="rounded-lg border border-border p-4" data-testid="audio-mirror-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {state === "live" ? (
            <Volume2 className="h-5 w-5 text-primary" aria-hidden />
          ) : (
            <VolumeX className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">Audio Mirror</span>
          <Badge variant={STATE_VARIANT[state]} data-testid="audio-mirror-state">
            {STATE_LABEL[state]}
          </Badge>
        </div>
        <Button
          size="sm"
          variant={running ? "outline" : "default"}
          onClick={() => (running ? void stop() : void start())}
          data-testid="audio-mirror-toggle"
        >
          {running ? "Stop" : "Listen"}
        </Button>
      </div>

      {state === "live" && droppedPackets > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="audio-mirror-dropped">
          {droppedPackets} dropped packet{droppedPackets === 1 ? "" : "s"}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert" data-testid="audio-mirror-error">
          {error}
        </p>
      )}
    </div>
  );
}

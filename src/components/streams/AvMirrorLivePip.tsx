/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Tv, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAvMirror } from "@/hooks/useAvMirror";
import { LiveDot } from "./AvMirrorControls";

/**
 * A tiny app-bar indicator shown ONLY while an A/V mirror stream is live, so a user
 * who started audio-only (which has no visible panel) is never left wondering whether
 * it's still running. Tapping it stops all mirroring — a one-touch global off.
 * Renders nothing when nothing is streaming, so it's invisible in the common case.
 */
export function AvMirrorLivePip() {
  const { anyLive, videoLive, stopAll } = useAvMirror();
  if (!anyLive) return null;

  return (
    <Button
      size="icon"
      variant="ghost"
      className="relative h-9 w-9"
      onClick={() => void stopAll()}
      aria-label="Live mirror active — tap to stop"
      title="Live mirror active — tap to stop"
      data-testid="av-mirror-live-pip"
    >
      {videoLive ? <Tv className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
      <LiveDot className="absolute right-1 top-1" />
    </Button>
  );
}

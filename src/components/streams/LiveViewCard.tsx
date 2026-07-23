/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { MonitorPlay, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvMirror } from "@/hooks/useAvMirror";
import { AvMirrorControls } from "./AvMirrorControls";
import { AvMirrorPreview } from "./AvMirrorPreview";
import { AvSyncPanel } from "./AvSyncPanel";

export interface LiveViewCardProps {
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  className?: string;
}

/**
 * The compact "Live View" control for Home / Play: Audio + Video toggles and a
 * collapsible small "check" preview of the running machine. Deliberately small —
 * audio-only shows just the lit toggle; video shows a thumbnail that can expand.
 * The full zoom/pan experience lives in Remote Input game mode (see 06-av-mirror-ux).
 */
export function LiveViewCard({ audioEnabled = true, videoEnabled = true, className }: LiveViewCardProps) {
  const { video } = useAvMirror();
  const [expanded, setExpanded] = useState(false);
  const showPreview = videoEnabled && video.state !== "off";

  return (
    <div className={cn("rounded-lg border border-border p-3", className)} data-testid="live-view-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MonitorPlay className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="font-medium">Live View</span>
        </div>
        <div className="flex items-center gap-2">
          <AvMirrorControls showAudio={audioEnabled} showVideo={videoEnabled} />
          {showPreview && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={expanded ? "Collapse preview" : "Expand preview"}
              aria-pressed={expanded}
              onClick={() => setExpanded((value) => !value)}
              data-testid="live-view-expand"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      {showPreview && (
        <div className="mt-3 flex justify-center">
          <AvMirrorPreview size={expanded ? "immersive" : "check"} />
        </div>
      )}

      {showPreview && expanded && <AvSyncPanel className="mt-3" />}

      <p className="mt-2 text-xs text-muted-foreground">
        Hear{videoEnabled ? " and see" : ""} the running machine. Open Remote Input for the full zoomable screen.
      </p>
    </div>
  );
}

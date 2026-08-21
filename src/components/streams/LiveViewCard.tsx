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
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useAvMirror } from "@/hooks/useAvMirror";
import { AvMirrorControls } from "./AvMirrorControls";
import { AvMirrorPreview } from "./AvMirrorPreview";
import { AvSyncPanel } from "./AvSyncPanel";
import { StreamStatsPanel } from "./StreamStatsPanel";
import { HelperText } from "@/components/ui/HelperText";

export interface LiveViewCardProps {
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  /** Show the A/V Sync + Tap latency measurement tools (gated by the av_sync_tests feature flag). */
  showAvSyncTests?: boolean;
  className?: string;
}

/**
 * The compact "Live View" control for Home / Play: Audio + Video toggles and a
 * collapsible small "check" preview of the running machine. Deliberately small —
 * audio-only shows just the lit toggle; video shows a thumbnail that can expand.
 * The full zoom/pan experience lives in Remote Input game mode (see 06-av-mirror-ux).
 */
export function LiveViewCard({
  audioEnabled = true,
  videoEnabled = true,
  showAvSyncTests = true,
  className,
}: LiveViewCardProps) {
  const { video, anyLive, stopAll } = useAvMirror();
  const [expanded, setExpanded] = useState(false);
  const showPreview = videoEnabled && video.state !== "off";

  return (
    <CollapsibleSection
      scope="home"
      id="live-view"
      title="Live View"
      icon={MonitorPlay}
      testId="live-view-card"
      className={className}
      // Closed on a first visit. Mirroring is something a listener turns on deliberately, and the
      // card carries a preview, the stream statistics and the A/V measurement tools underneath it.
      defaultOpen={false}
      actions={
        anyLive ? (
          // Stops both streams without opening the card. Mirroring keeps a multicast receiver and
          // an audio track running, so "stop it now" has to be reachable from the closed card —
          // otherwise the only way to stop it is to open the card and find the two toggles.
          <Button
            variant="outline"
            size="sm"
            onClick={stopAll}
            // The word on the button matches every other card's header action; the accessible name
            // says what this one actually does, which is stop both feeds.
            aria-label="Stop Live View"
            data-testid="live-view-stop"
          >
            Reset
          </Button>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AvMirrorControls showAudio={audioEnabled} showVideo={videoEnabled} />
        {showPreview && (
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11"
            aria-label={expanded ? "Collapse preview" : "Expand preview"}
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
            data-testid="live-view-expand"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {showPreview && (
        <div className="flex justify-center">
          <AvMirrorPreview size={expanded ? "immersive" : "check"} />
        </div>
      )}

      {anyLive && <StreamStatsPanel />}

      {showPreview && showAvSyncTests && <AvSyncPanel />}

      <HelperText>
        Hear{videoEnabled ? " and see" : ""} the running machine. Open Remote Input for the full zoomable screen.
      </HelperText>
    </CollapsibleSection>
  );
}

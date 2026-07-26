/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { Cpu, Smartphone, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";

/**
 * "Listen on: [C64] [Both] [This device]" (spec §12.5, Track B / LE2).
 *
 * The control asks ONE question — which speakers you hear the tune on — and
 * every option names speakers, so the middle one is simply the union of the
 * outer two. That framing is deliberate. The underlying state is really two
 * independent facts (which engine renders the tune, and whether the C64's audio
 * is streamed here), and labelling the middle option as a compound of the other
 * two reads badly however it is phrased, because "C64" is a device and "here"
 * is a location. Asking a single question turns the compound into a plain word.
 *
 * Mapping:
 *   C64          engine = c64,   audio mirror off
 *   Both         engine = c64,   audio mirror on
 *   This device  engine = local  (rendered here; there is no C64 audio to mirror)
 */
type ListenTarget = "c64" | "both" | "local";

export function PlaybackEngineToggle({ className }: { className?: string }) {
  const { engine, setEngine } = usePlaybackEngine();
  const { audioLive, session } = useAvMirror();
  const { value: liveViewEnabled } = useFeatureFlag("live_view_enabled");
  const { value: audioMirrorEnabled } = useFeatureFlag("audio_mirror_enabled");
  // Latched when the device refuses to stream, so a route that demonstrably
  // does not work stops being offered.
  const [streamingFailed, setStreamingFailed] = useState(false);

  /**
   * "Both" is HIDDEN, not disabled, when the C64's audio cannot reach this
   * device — an option that cannot work should not occupy a third of the
   * control and invite a tap that does nothing.
   */
  const canStreamBack = liveViewEnabled && audioMirrorEnabled && !streamingFailed;

  const selected: ListenTarget = engine === "local" ? "local" : audioLive && canStreamBack ? "both" : "c64";

  const select = (target: ListenTarget) => {
    if (target === "local") {
      // Nothing to mirror once the tune renders here, and leaving the stream up
      // would keep the C64's audio playing underneath the on-device engine.
      if (audioLive) void session.stopAudio().catch(() => undefined);
      setEngine("local");
      return;
    }
    setEngine("c64");
    const wantMirror = target === "both";
    if (wantMirror === audioLive) return;
    void (wantMirror ? session.startAudio() : session.stopAudio()).catch((error) => {
      // A start that fails means this device cannot stream its audio here, so
      // stop offering the option rather than leaving a button that does nothing.
      if (wantMirror) setStreamingFailed(true);
      addLog("warn", "Playback: could not change the Live View audio route", {
        service: "playback",
        wantMirror,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const option = (value: ListenTarget, Icon: typeof Cpu, title: string, testId: string) => {
    const active = selected === value;
    return (
      <Button
        key={value}
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        data-testid={testId}
        aria-pressed={active}
        onClick={() => select(value)}
        className="gap-1.5"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {title}
      </Button>
    );
  };

  return (
    // Label ABOVE the buttons, and the buttons in a wrapping row — the same
    // shape as the SID emulation selector in Settings, which is the identical
    // interaction. Inline the label competes for width with three options; a
    // wrapping row degrades to a second line on a narrow screen instead of
    // truncating, and single-word titles keep the block two lines tall.
    <div
      role="group"
      aria-label="Listen on"
      data-testid="playback-engine-toggle"
      className={cn("space-y-1.5 min-w-0", className)}
    >
      <Label className="text-xs font-medium text-muted-foreground">Listen on</Label>
      <div className="flex flex-wrap gap-2">
        {option("c64", Cpu, "C64", "playback-engine-c64")}
        {canStreamBack ? option("both", Volume2, "Both", "playback-listen-both") : null}
        {option("local", Smartphone, "This device", "playback-engine-local")}
      </div>
    </div>
  );
}

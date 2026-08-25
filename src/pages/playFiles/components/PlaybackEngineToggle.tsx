/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { saveMirrorC64Audio } from "@/lib/config/appSettings";

/**
 * "Listen on: [Local] [Remote] [Both]" (spec §12.5, Track B / LE2).
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
 *   <device>  engine = c64,   audio mirror off
 *   Both      engine = c64,   audio mirror on
 *   Local     engine = local  (rendered here; there is no C64 audio to mirror)
 *
 * The first two persist that choice (`saveMirrorC64Audio`), because playback starts the mirror by
 * itself whenever a tune moves to the C64 and would otherwise overrule the listener on the very
 * next track. "Local" deliberately does not touch it: it answers a different question, and the
 * C64 route should be as it was left when playback returns to it.
 *
 * Naming follows `sourceTerms`, as the "Choose source" dialog, the playlist rows and the
 * disks list do; this control used to invent its own word and its own glyph, so one machine
 * appeared under three names and two icons. The origin icons are deliberately absent now: a
 * third of this row at 320 CSS px cannot hold icon plus label. If one ever returns here it is
 * `FileOriginIcon`, never a lucide stand-in.
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
      if (audioLive) {
        void session.stopAudio().catch((error) => {
          // A failed stop here means the C64's mirrored audio keeps playing
          // audibly underneath the newly started local engine (HARD25-007) - log it
          // the same way the "both"/"c64" branch below logs its own stopAudio()/
          // startAudio() failure, instead of discarding it silently.
          addLog("warn", "Playback: could not stop the Live View audio route", {
            service: "playback",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      setEngine("local");
      return;
    }
    setEngine("c64");
    const wantMirror = target === "both";
    // Remember the answer, don't just act on it. Playback starts the mirror for you when a tune goes
    // to the C64, and without a recorded preference it did that even to a listener who had just
    // chosen the C64's own speakers — so "<device>" lasted until the next track and no longer.
    saveMirrorC64Audio(wantMirror);
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

  const option = (value: ListenTarget, title: string, testId: string) => {
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
        // `px-1` rather than the size variant's `px-3`: the grid column decides the width, so
        // the padding only sets a minimum, and `px-3` puts "Remote" over a third of a 320px row.
        // `min-w-0` is deliberately NOT set — `buttonVariants` carries the 44px `min-w-11` floor.
        className="px-1"
      >
        {title}
      </Button>
    );
  };

  return (
    // Label above, options in an equal-width grid sized to how many are actually rendered.
    // A wrapping row cost a whole second line at 320 CSS px — three buttons need 305px of a
    // 278px column — making a 44px control 96px tall on the screen with the least room. Equal
    // columns hold one line and weight the options equally, which is what they are.
    // Measured in docs/plans/segmented-control/PROPOSAL.md.
    <div
      role="group"
      aria-label="Listen on"
      data-testid="playback-engine-toggle"
      className={cn("space-y-1.5 min-w-0", className)}
    >
      <Label className="text-xs font-medium text-muted-foreground">Listen on</Label>
      {/* `auto-fit` rather than a fixed column count: each option is one word, so it cannot wrap
          out of a track that is too narrow for it. At the largest Text size on a 320px screen
          "Remote" needed 88px against a 78px track and was clipped. With a track floor the row
          drops to fewer columns instead, and each option keeps its whole label. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
        {/* Local, Remote, Both — in that order, so the row reads as a progression from this device
            outwards to both. "Remote" rather than the device's name or host: the header already says
            which device is connected, repeating it here spent the row's width on something already on
            screen, and the wording now matches Remote Input. */}
        {option("local", "Local", "playback-engine-local")}
        {option("c64", "Remote", "playback-engine-c64")}
        {canStreamBack ? option("both", "Both", "playback-listen-both") : null}
      </div>
    </div>
  );
}

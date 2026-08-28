/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";

import { ChevronDown, MonitorSpeaker } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addLog } from "@/lib/logging";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { saveMirrorC64Audio } from "@/lib/config/appSettings";

/**
 * "Listen: [Here] [C64] [Both]" (spec §12.5, Track B / LE2).
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
  const [open, setOpen] = useState(false);

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
        onClick={() => {
          select(value);
          setOpen(false);
        }}
        className="w-full justify-start px-2"
      >
        {title}
      </Button>
    );
  };

  const currentLabel = selected === "local" ? "Here" : selected === "both" ? "Both" : "C64";

  return (
    /*
     * An output chip, not a row of three buttons.
     *
     * The three-button block sat at the top of the card and took 126 CSS px of a 427 px screen — 30%
     * of the viewport for a routing preference — which pushed the transport, the reason the page
     * exists, to within 118 px of the bottom. Routing is the established job of a single output
     * affordance (AirPlay, Cast, Spotify Connect all do this): one quiet element showing where the
     * sound goes, which expands only when you want to move it. It now sits with the volume control,
     * so one row answers where the sound goes and how loud it is.
     *
     * "Here", not "Local": the app also runs on tablets and a desktop browser, and `SOURCE_LABELS`
     * spends "Local" on a different question — which files you are browsing, not which speakers you
     * are using. One D-pad stop instead of three, and every option is still one press away inside.
     */
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="playback-engine-toggle"
          /* The selected destination, readable while the chooser is closed. The options carry
             aria-pressed, but they exist only while the popover is open, so nothing outside the
             component could otherwise tell where the sound is going. */
          data-engine={selected}
          aria-label={`Listen on ${currentLabel}. Change where the sound comes out.`}
          className={cn("h-11 shrink-0 gap-1 rounded-full bg-muted px-2.5 text-xs font-normal", className)}
        >
          {/* MonitorSpeaker, not Volume2: the mute button sits immediately to the right of this
              chip and already carries a speaker glyph, so two of them side by side read as one
              control drawn twice. This one means "output destination", which is the question the
              chip answers. */}
          <MonitorSpeaker className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>{currentLabel}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1" data-testid="playback-engine-options">
        {/* Real buttons, not menu items: the keypad ring walks buttons, and each keeps the testid
            the HIL harness and the unit tests already address. */}
        {option("local", "Here", "playback-engine-local")}
        {option("c64", "C64", "playback-engine-c64")}
        {canStreamBack ? option("both", "Both", "playback-listen-both") : null}
      </PopoverContent>
    </Popover>
  );
}

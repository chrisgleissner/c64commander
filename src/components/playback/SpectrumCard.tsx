/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AudioWaveform, ChartNoAxesColumn, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ScreenActivityWatch } from "@/components/ScreenActivityWatch";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useActivePlayback } from "@/hooks/useActivePlayback";
import { useAvMirror } from "@/hooks/useAvMirror";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { SpectrumView, type SpectrumReadout } from "@/lib/audio/spectrum/spectrumView";
import { METER_AREA_HEIGHT_PX } from "@/lib/audio/spectrum/spectrumRenderer";
import { cn } from "@/lib/utils";
import { getSpectrumViewMode, setSpectrumViewMode, type SpectrumViewMode } from "@/lib/uiPreferences";

export const SPECTRUM_UNAVAILABLE_MESSAGE = "Spectrum is available for sound played on this phone";

const CANVAS_HEIGHT_PX: Record<string, number> = { compact: 110, medium: 190, expanded: 240 };

const THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-app-style", "data-palette"];

const CANVAS_LABELS: Record<SpectrumViewMode, string> = {
  bars: "Audio channel meters growing from left to right: solid average level, translucent instantaneous peak, and a held peak marker on a shared dBFS scale; frequency spectrum below, bass to treble",
  wave: "Audio channel meters, with the waveform of the sound below",
};

const VIEW_OPTIONS: ReadonlyArray<{ mode: SpectrumViewMode; label: string; icon: LucideIcon }> = [
  { mode: "bars", label: "Bars", icon: ChartNoAxesColumn },
  { mode: "wave", label: "Wave", icon: Activity },
];

const formatLevel = (db: number | null) => (db === null ? "—" : String(db));

export interface SpectrumCardProps {
  /** The tune on screen is being played by this phone, so there is sound to show. */
  soundOnPhone: boolean;
  /** That tune is paused. */
  paused: boolean;
}

interface SpectrumPanelProps extends SpectrumCardProps {
  profile: string;
  mode: SpectrumViewMode;
}

interface SpectrumViewSwitchProps {
  mode: SpectrumViewMode;
  onChange: (mode: SpectrumViewMode) => void;
  /** On the compact profile the header has room for two 44 px icon buttons but not for two words at 18 px. */
  iconOnly: boolean;
}

const SpectrumViewSwitch = ({ mode, onChange, iconOnly }: SpectrumViewSwitchProps) => (
  <div role="group" aria-label="Spectrum view" className="flex items-center gap-0.5" data-testid="spectrum-view-group">
    {VIEW_OPTIONS.map((option) => (
      <Button
        key={option.mode}
        variant="outline"
        className={cn(iconOnly ? "px-0" : "px-3", mode === option.mode && "bg-accent text-accent-foreground")}
        aria-pressed={mode === option.mode}
        onClick={() => onChange(option.mode)}
        data-testid={`spectrum-view-${option.mode}`}
      >
        <option.icon aria-hidden="true" />
        <span className={iconOnly ? "sr-only" : undefined}>{option.label}</span>
      </Button>
    ))}
  </div>
);

const SpectrumPanel = ({ soundOnPhone, paused, profile, mode }: SpectrumPanelProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<SpectrumView | null>(null);
  const rmsRef = useRef<HTMLSpanElement | null>(null);
  const peakRef = useRef<HTMLSpanElement | null>(null);
  const channelsRef = useRef<HTMLSpanElement | null>(null);
  const clipRef = useRef<HTMLSpanElement | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [active, setActive] = useState(false);
  const height = CANVAS_HEIGHT_PX[profile] ?? CANVAS_HEIGHT_PX.medium;
  const chartHeight = height + METER_AREA_HEIGHT_PX;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const writeReadout = useCallback((readout: SpectrumReadout) => {
    if (rmsRef.current) rmsRef.current.textContent = formatLevel(readout.rmsDb);
    if (peakRef.current) peakRef.current.textContent = formatLevel(readout.peakDb);
    if (channelsRef.current)
      channelsRef.current.textContent =
        readout.channels
          ?.map(
            (channel) =>
              `${channel.label}: average ${formatLevel(channel.rmsDb)} dBFS, peak ${formatLevel(channel.peakDb)} dBFS`,
          )
          .join(". ") ?? "";
    clipRef.current?.setAttribute("data-clipping", readout.clipped ? "true" : "false");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const view = new SpectrumView({
      canvas,
      profile,
      mode: modeRef.current,
      onReadout: writeReadout,
      onActiveChange: setActive,
      onTierChange: (tier) => {
        canvas.dataset.spectrumTier = String(tier.index);
      },
    });
    viewRef.current = view;
    canvas.dataset.spectrumTier = String(view.currentTier.index);
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      view.resize(box.width, box.height, window.devicePixelRatio);
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => view.refreshTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    const onVisibility = () => view.setDocumentShowing(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    view.setDocumentShowing(!document.hidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      view.dispose();
      viewRef.current = null;
    };
  }, [profile, writeReadout]);

  useEffect(() => {
    viewRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    viewRef.current?.setState({ visible: onScreen && soundOnPhone, paused });
  }, [onScreen, soundOnPhone, paused, profile]);

  const message = active
    ? null
    : !soundOnPhone
      ? SPECTRUM_UNAVAILABLE_MESSAGE
      : paused
        ? "Paused"
        : "Waiting for sound";

  return (
    <div className="space-y-2 p-3 pt-0" data-testid="spectrum-panel">
      <ScreenActivityWatch onChange={setOnScreen} />
      <div className="sr-only" data-testid="spectrum-readout">
        <span ref={channelsRef} data-testid="spectrum-channel-readout" />{" "}
        <span>
          Level <span ref={rmsRef} data-testid="spectrum-rms" /> dB
        </span>{" "}
        <span>
          Peak <span ref={peakRef} data-testid="spectrum-peak" /> dB
        </span>{" "}
        <span ref={clipRef} data-clipping="false" data-testid="spectrum-clip">
          Clip
        </span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={CANVAS_LABELS[mode]}
          className="block w-full rounded-panel border border-border bg-background"
          style={{ height: chartHeight }}
          data-testid="spectrum-canvas"
        />
        {message ? (
          <p
            style={{ top: `calc(50% + ${METER_AREA_HEIGHT_PX / 2}px)` }}
            role="status"
            data-testid="spectrum-message"
            className="pointer-events-none absolute inset-x-3 -translate-y-1/2 rounded-md bg-background/85 px-3 py-2 text-center text-base text-foreground"
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
};

/**
 * The live spectrum of the sound this phone is playing, on the Play page. It exists only when the
 * native plugin can analyse sound, and it does no work while collapsed, off screen or paused.
 */
export const SpectrumCard = ({ soundOnPhone, paused }: SpectrumCardProps) => {
  const available = useAudioFxAvailable();
  const { profile } = useDisplayProfile();
  const [openByDefault] = useState(soundOnPhone);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(getSpectrumViewMode);
  const chooseMode = useCallback((next: SpectrumViewMode) => {
    setMode(next);
    setSpectrumViewMode(next);
  }, []);
  if (!available) return null;
  return (
    <CollapsibleSection
      scope="play"
      id="spectrum"
      title="Spectrum"
      summary="Live level of the sound from this phone"
      icon={AudioWaveform}
      defaultOpen={openByDefault}
      onOpenChange={setOpen}
      actions={
        open ? <SpectrumViewSwitch mode={mode} onChange={chooseMode} iconOnly={profile === "compact"} /> : undefined
      }
      testId="play-section-spectrum"
    >
      <SpectrumPanel soundOnPhone={soundOnPhone} paused={paused} profile={profile} mode={mode} />
    </CollapsibleSection>
  );
};

/** Follow the source actually playing on the phone, including Live View audio. */
export const PlaybackSpectrumCard = ({ paused }: { paused: boolean }) => {
  const playback = useActivePlayback();
  const mirror = useAvMirror();
  return (
    <SpectrumCard
      soundOnPhone={playback.local || mirror.audioLive}
      paused={playback.local && !mirror.audioLive && paused}
    />
  );
};

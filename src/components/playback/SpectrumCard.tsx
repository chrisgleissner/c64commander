/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioWaveform } from "lucide-react";

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ScreenActivityWatch } from "@/components/ScreenActivityWatch";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useAudioFxAvailable } from "@/lib/audio/useAudioFxAvailable";
import { SpectrumView, type SpectrumReadout } from "@/lib/audio/spectrum/spectrumView";
import { cn } from "@/lib/utils";

export const SPECTRUM_UNAVAILABLE_MESSAGE = "Spectrum is available for sound played on this phone";

const CANVAS_HEIGHT_PX: Record<string, number> = { compact: 150, medium: 190, expanded: 240 };

const THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-app-style", "data-palette"];

const formatLevel = (db: number | null) => (db === null ? "—" : String(db));

export interface SpectrumCardProps {
  /** The tune on screen is being played by this phone, so there is sound to show. */
  soundOnPhone: boolean;
  /** That tune is paused. */
  paused: boolean;
}

interface SpectrumPanelProps extends SpectrumCardProps {
  profile: string;
}

const SpectrumPanel = ({ soundOnPhone, paused, profile }: SpectrumPanelProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<SpectrumView | null>(null);
  const rmsRef = useRef<HTMLSpanElement | null>(null);
  const peakRef = useRef<HTMLSpanElement | null>(null);
  const clipRef = useRef<HTMLSpanElement | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [active, setActive] = useState(false);
  const height = CANVAS_HEIGHT_PX[profile] ?? CANVAS_HEIGHT_PX.medium;

  const writeReadout = useCallback((readout: SpectrumReadout) => {
    if (rmsRef.current) rmsRef.current.textContent = formatLevel(readout.rmsDb);
    if (peakRef.current) peakRef.current.textContent = formatLevel(readout.peakDb);
    clipRef.current?.setAttribute("data-clipping", readout.clipped ? "true" : "false");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const view = new SpectrumView({
      canvas,
      profile,
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
    viewRef.current?.setState({ visible: onScreen, paused });
  }, [onScreen, paused, profile]);

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="spectrum-readout">
        <span className="whitespace-nowrap text-muted-foreground">
          Level <span ref={rmsRef} className="font-semibold tabular-nums text-foreground" data-testid="spectrum-rms" />{" "}
          dB
        </span>
        <span className="whitespace-nowrap text-muted-foreground">
          Peak <span ref={peakRef} className="font-semibold tabular-nums text-foreground" data-testid="spectrum-peak" />{" "}
          dB
        </span>
        <span
          ref={clipRef}
          data-clipping="false"
          data-testid="spectrum-clip"
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground",
            "[&[data-clipping=true]]:font-semibold [&[data-clipping=true]]:text-destructive",
          )}
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/30 [[data-clipping=true]>&]:bg-destructive"
          />
          <span className={profile === "compact" ? "sr-only" : undefined}>Clip</span>
        </span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Spectrum of the sound playing on this phone, level in dB by frequency"
          className="block w-full rounded-lg border border-border"
          style={{ height }}
          data-testid="spectrum-canvas"
        />
        {message ? (
          <p
            role="status"
            data-testid="spectrum-message"
            className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-md bg-background/85 px-3 py-2 text-center text-base text-foreground"
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
  if (!available) return null;
  return (
    <CollapsibleSection
      scope="play"
      id="spectrum"
      title="Spectrum"
      summary="Live level of the sound from this phone"
      icon={AudioWaveform}
      defaultOpen={openByDefault}
      testId="play-section-spectrum"
    >
      <SpectrumPanel soundOnPhone={soundOnPhone} paused={paused} profile={profile} />
    </CollapsibleSection>
  );
};

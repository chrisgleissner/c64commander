/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Cpu, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";

/**
 * The single "Play on: [C64] [This device]" control (spec §12.5, Track B / LE2).
 * Shown by the Play page whenever a SID is the current item and the on-device
 * engine is enabled. Plain buttons (not a Radix group) to stay light and
 * test-friendly; the choice persists globally via {@link usePlaybackEngine}.
 */
export function PlaybackEngineToggle({ className }: { className?: string }) {
  const { engine, setEngine } = usePlaybackEngine();

  const option = (value: "c64" | "local", Icon: typeof Cpu, title: string, subtitle: string, testId: string) => {
    const active = engine === value;
    return (
      <button
        type="button"
        data-testid={testId}
        aria-pressed={active}
        onClick={() => setEngine(value)}
        className={cn(
          "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-left transition-colors min-w-0",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-tight truncate">{title}</span>
          <span className="block text-[11px] leading-tight opacity-80 truncate">{subtitle}</span>
        </span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Playback engine"
      data-testid="playback-engine-toggle"
      className={cn("flex items-stretch gap-1 rounded-lg border border-border/70 p-1", className)}
    >
      {option("c64", Cpu, "C64", "hear via Live View", "playback-engine-c64")}
      {option("local", Smartphone, "This device", "device speaker · no C64", "playback-engine-local")}
    </div>
  );
}

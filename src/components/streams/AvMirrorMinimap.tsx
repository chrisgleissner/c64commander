/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useAvMirrorCanvas } from "@/hooks/useAvMirror";
import { viewportRect, type Viewport } from "@/lib/streams/mirrorViewport";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

export interface AvMirrorMinimapProps {
  viewport: Viewport;
  /** Called with normalized [0,1] coords when the user taps/drags to reposition. */
  onSeek: (cx: number, cy: number) => void;
  session?: AvMirrorSession;
  className?: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A small full-frame thumbnail of the whole C64 screen with the current viewport drawn
 * as a rectangle. Tapping or dragging on it repositions the pan instantly — a fast,
 * spatial "show me that part" control. Renders the same shared stream at native res.
 */
export function AvMirrorMinimap({ viewport, onSeek, session, className }: AvMirrorMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useAvMirrorCanvas(canvasRef, session);
  const rect = viewportRect(viewport);

  const seekFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    onSeek(
      clamp01((event.clientX - bounds.left) / bounds.width),
      clamp01((event.clientY - bounds.top) / bounds.height),
    );
  };

  // Keyboard / D-pad panning (the C64U Remote target has a keypad, no pointer): arrow keys nudge
  // the viewport centre by a step so the minimap is operable without a touchscreen.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = 0.1;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;
    event.preventDefault();
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    onSeek(clamp01(centerX + dx), clamp01(centerY + dy));
  };

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      aria-label="Live view minimap — arrow keys pan the viewport"
      className={cn(
        "relative w-28 shrink-0 cursor-pointer overflow-hidden rounded border border-white/40 bg-black touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400",
        className,
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) seekFromEvent(event);
      }}
      onKeyDown={onKeyDown}
      data-testid="av-mirror-minimap"
    >
      <canvas
        ref={canvasRef}
        width={384}
        height={272}
        className="pointer-events-none block w-full"
        style={{ imageRendering: "pixelated", aspectRatio: "384 / 272" }}
      />
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-amber-400 bg-amber-300/10"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        }}
        data-testid="av-mirror-minimap-viewport"
      />
    </div>
  );
}

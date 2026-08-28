/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from "@/lib/utils";
import { Library } from "lucide-react";

type FileOrigin = "ultimate" | "local" | "hvsc" | "commoserve";

type FileOriginIconProps = {
  origin: FileOrigin;
  className?: string;
  glyphClassName?: string;
  label?: string;
};

/**
 * The C64U ("breadbin") and local-device glyphs, inlined rather than loaded through <img>, so that
 * stroke="currentColor" follows the surrounding text colour like every other icon in the app. An
 * SVG behind <img> is an opaque image resource where currentColor cannot resolve, which is what
 * the previous dark:invert dark:brightness-0 hack worked around — imprecisely, and in a way that
 * broke under any non-neutral appearance style.
 */
const C64uGlyph = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
  >
    <rect x={4.5} y={15} width={15} height={2} rx={1} />
    <line x1={4.5} y1={15} x2={6.5} y2={10.5} />
    <line x1={19.5} y1={15} x2={17.5} y2={10.5} />
    <line x1={6.5} y1={10.5} x2={17.5} y2={10.5} />
  </svg>
);

const DeviceGlyph = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
  >
    <rect x={7} y={2.5} width={10} height={19} rx={2.5} ry={2.5} />
    <line x1={9.5} y1={6.5} x2={14.5} y2={6.5} />
    <line x1={9.5} y1={17.5} x2={14.5} y2={17.5} />
  </svg>
);

const resolveIconLabel = (origin: FileOrigin) =>
  origin === "ultimate"
    ? "C64U file"
    : origin === "hvsc"
      ? "HVSC file"
      : origin === "commoserve"
        ? "Online archive file"
        : "Local file";

export const FileOriginIcon = ({ origin, className, glyphClassName, label }: FileOriginIconProps) => {
  const ariaLabel = label ?? resolveIconLabel(origin);

  if (origin === "hvsc") {
    return (
      <span
        aria-label={ariaLabel}
        data-testid="file-origin-icon"
        role="img"
        className={cn("inline-flex items-center justify-center shrink-0 opacity-70 select-none", className)}
      >
        <span aria-hidden="true" className="text-[0.9em] leading-none">
          ♫
        </span>
      </span>
    );
  }
  if (origin === "commoserve") {
    return (
      <span
        aria-label={ariaLabel}
        data-testid="file-origin-icon"
        role="img"
        className={cn("inline-flex items-center justify-center shrink-0 opacity-70", className)}
      >
        <Library aria-hidden="true" className={cn("h-full w-full", glyphClassName)} strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      aria-label={ariaLabel}
      data-testid="file-origin-icon"
      role="img"
      className={cn("inline-flex items-center justify-center shrink-0 opacity-70", className)}
    >
      {origin === "ultimate" ? <C64uGlyph /> : <DeviceGlyph />}
    </span>
  );
};

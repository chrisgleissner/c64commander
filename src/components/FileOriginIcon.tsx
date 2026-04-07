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

const resolveIconSource = (origin: FileOrigin) => {
  const base = typeof import.meta !== "undefined" ? import.meta.env.BASE_URL || "/" : "/";
  if (origin === "ultimate") return `${base}c64u-icon.svg`;
  return `${base}device-icon.svg`;
};

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
      className={cn(
        "inline-flex items-center justify-center shrink-0 opacity-70 dark:invert dark:brightness-0",
        className,
      )}
    >
      <img src={resolveIconSource(origin)} alt="" aria-hidden="true" className="h-full w-full" />
    </span>
  );
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  INTERSTITIAL_Z_INDEX,
  resolveCenteredOverlayLayout,
  resolveInterstitialBackdropOpacity,
} from "@/components/ui/interstitialStyles";
import { useRegisterInterstitial } from "@/components/ui/interstitial-state";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";

export type AddItemsProgressState = {
  status: "idle" | "scanning" | "ingesting" | "committing" | "ready" | "error" | "done";
  count: number;
  elapsedMs: number;
  total: number | null;
  message: string | null;
};

type AddItemsProgressOverlayProps = {
  progress: AddItemsProgressState;
  title?: string;
  testId?: string;
  visible?: boolean;
  onCancel?: () => void;
};

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const ACTIVE_PROGRESS_STATES = new Set<AddItemsProgressState["status"]>(["scanning", "ingesting", "committing"]);

const resolveTitle = (title: string, status: AddItemsProgressState["status"]) => {
  if (title !== "Scanning…") return title;
  if (status === "ingesting") return "Importing…";
  if (status === "committing") return "Committing…";
  if (status === "ready") return "Ready";
  if (status === "error") return "Import failed";
  return title;
};

export const AddItemsProgressOverlay = ({
  progress,
  title = "Scanning…",
  testId,
  visible,
  onCancel,
}: AddItemsProgressOverlayProps) => {
  const isVisible = visible === true || (visible !== false && ACTIVE_PROGRESS_STATES.has(progress.status));
  const layer = useRegisterInterstitial("progress", isVisible);

  if (!isVisible) return null;

  const { top } = resolveCenteredOverlayLayout(176);

  const overlay = (
    <div
      className={cn(
        "fixed inset-0 flex items-start justify-center px-4 pb-[calc(1.5rem+var(--safe-area-inset-bottom))]",
        APP_INTERSTITIAL_BACKDROP_CLASSNAME,
      )}
      data-interstitial-depth={layer?.depth ?? 1}
      style={{
        backgroundColor: `rgb(0 0 0 / ${layer?.backdropOpacity ?? resolveInterstitialBackdropOpacity(1)})`,
        paddingTop: `${top}px`,
        zIndex: layer?.backdropZIndex ?? INTERSTITIAL_Z_INDEX.backdrop,
      }}
      data-testid={testId}
    >
      <div
        className={cn(
          "w-full max-w-sm rounded-[var(--interstitial-radius)] border border-border bg-background px-5 py-4 shadow-[var(--interstitial-shadow)]",
          "max-h-[calc(100dvh-3rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]",
        )}
        style={{ zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{resolveTitle(title, progress.status)}</p>
          <span className="text-xs text-muted-foreground">{formatElapsed(progress.elapsedMs)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {progress.message || "Scanning files"} • {progress.count} found
          {progress.total ? ` / ${progress.total}` : ""}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70" />
        </div>
        {onCancel ? (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return overlay;
  }

  return createPortal(overlay, document.body);
};

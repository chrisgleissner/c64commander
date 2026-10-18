/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SidAudioReadStateProps = {
  status: "loading" | "error";
  onRetry: () => void;
};

export function SidAudioReadState({ status, onRetry }: SidAudioReadStateProps) {
  if (status === "loading") {
    return (
      <div className="space-y-2" role="status" aria-label="Reading audio settings" data-testid="home-sid-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border bg-card p-3"
      role="alert"
      data-testid="home-sid-read-error"
    >
      <span className="text-sm text-muted-foreground">Could not read from the device</span>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 min-w-11 px-3 text-sm"
        onClick={onRetry}
        data-testid="home-sid-read-retry"
      >
        Retry
      </Button>
    </div>
  );
}

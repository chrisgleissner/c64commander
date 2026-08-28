/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { requestTourStart } from "@/lib/tour/tourState";

/**
 * Restarting the tour, from Docs (spec.md D10). A tour that can only be taken once helps only once,
 * and a first-run walkthrough is exactly the thing someone wants again a week later.
 */
export const TourRestartCard = () => (
  <section
    className="space-y-2 rounded-panel border border-border bg-card p-4"
    data-testid="docs-tour-card"
    data-section-label="Take the tour"
  >
    <h2 className="flex items-center gap-2 text-base font-semibold">
      <Compass className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      {t("tour.card.title", "Take the tour")}
    </h2>
    <p className="text-sm text-muted-foreground">
      {t("tour.card.body", "A short walk through what this app does. You can leave it at any point.")}
    </p>
    <Button onClick={() => requestTourStart()} className="min-h-11" data-testid="docs-tour-start">
      {t("tour.card.start", "Start the tour")}
    </Button>
  </section>
);

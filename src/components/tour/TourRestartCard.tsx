/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { t } from "@/lib/i18n";
import { requestTourStart } from "@/lib/tour/tourState";

/**
 * Restarting the tour, from Docs (spec.md D10). A tour that can only be taken once helps only once,
 * and a first-run walkthrough is exactly the thing someone wants again a week later.
 */
export const TourRestartCard = () => {
  const { profile } = useDisplayProfile();
  const compact = profile === "compact";
  return (
    <CollapsibleSection
      scope="docs"
      id="tour"
      title={t("tour.card.title", "Take the tour")}
      summary="A short walk through what this app does"
      icon={Compass}
      testId="docs-tour-card"
    >
      <div className={compact ? "p-2 pt-0" : "space-y-2 p-4 pt-0"}>
        <Button onClick={() => requestTourStart()} className="min-h-11" data-testid="docs-tour-start">
          {compact ? t("tour.card.startShort", "Start") : t("tour.card.start", "Start the tour")}
        </Button>
      </div>
    </CollapsibleSection>
  );
};

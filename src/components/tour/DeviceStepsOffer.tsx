/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { Compass, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useC64Connection } from "@/hooks/useC64Connection";
import { t } from "@/lib/i18n";
import { DEVICE_STEP_IDS } from "@/lib/tour/steps";
import { loadTourState, requestTourStart, saveTourState } from "@/lib/tour/tourState";

/**
 * The three device steps, offered once after a first connection (spec.md D10).
 *
 * When the tour ran with no machine attached, steps 5 to 7 explained rather than pointed. This is
 * the one chance to see them for real. Dismissing clears the flag; it is never offered twice.
 */
export const DeviceStepsOffer = () => {
  const { status } = useC64Connection();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!status.isConnected) return;
    setPending(loadTourState().deviceStepsPending);
  }, [status.isConnected]);

  const dismiss = () => {
    saveTourState({ ...loadTourState(), deviceStepsPending: false });
    setPending(false);
  };

  if (!pending || !status.isConnected) return null;

  return (
    <section
      className="flex items-start gap-3 rounded-panel border border-border bg-card p-3"
      data-testid="home-tour-device-steps-offer"
    >
      <Compass className="mt-2 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">
          {t("tour.deviceSteps.offer", "Your C64 is connected. See the three tour steps that needed it?")}
        </p>
        <Button
          onClick={() => {
            dismiss();
            requestTourStart({ fromStepId: DEVICE_STEP_IDS[0] });
          }}
          className="min-h-11"
          data-testid="home-tour-device-steps-start"
        >
          {t("tour.deviceSteps.show", "Show me")}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={t("tour.deviceSteps.dismiss", "Dismiss")}
        className="size-11 shrink-0"
        data-testid="home-tour-device-steps-dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </section>
  );
};

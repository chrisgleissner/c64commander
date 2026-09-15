/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { reportFallback } from "@/lib/diagnostics/fallbackReporter";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";

/**
 * Whether the app should still offer Demo Mode on its own when no device can be reached. Somebody who has seen the
 * offer and has used a real C64 Ultimate is most likely just away from it, so their device shows as offline instead,
 * and it reconnects when it is back in reach. Demo Mode stays available from Settings.
 */
const DEMO_OFFER_SEEN_KEY = "c64u_demo_offer_seen";

export const noteDemoOfferShown = () => {
  try {
    localStorage.setItem(DEMO_OFFER_SEEN_KEY, "1");
  } catch (error) {
    // Without storage the offer is simply made again next time.
    reportFallback("demoOfferMemory.noteDemoOfferShown", error);
  }
};

const hasSeenDemoOffer = () => {
  try {
    return localStorage.getItem(DEMO_OFFER_SEEN_KEY) === "1";
  } catch (error) {
    reportFallback("demoOfferMemory.hasSeenDemoOffer", error);
    return false;
  }
};

export const isAwayFromKnownDevice = () =>
  hasSeenDemoOffer() && getSavedDevicesSnapshot().devices.some((device) => Boolean(device.lastSuccessfulConnectionAt));

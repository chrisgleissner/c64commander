/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";

import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { useActivePlayback } from "@/hooks/useActivePlayback";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useTourActive } from "@/hooks/useTourActive";
import { isNotificationPermissionMoment, requestNotificationPermissionOnce } from "@/lib/native/notificationPermission";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { loadTourState, shouldOfferTourOnLaunch } from "@/lib/tour/tourState";

/** Longer than TourHost's settle delay, so a first-launch tour is offered before this asks. */
export const NOTIFICATION_PERMISSION_SETTLE_MS = 1500;

/**
 * Asks for POST_NOTIFICATIONS once a connection has settled and nothing else is on screen, so the
 * system prompt never lands in the middle of starting a tune.
 */
export const NotificationPermissionMoment = () => {
  const interstitialActive = useInterstitialActive();
  const { state: connectionState } = useConnectionState();
  const tourActive = useTourActive();
  const { any: playbackActive } = useActivePlayback();
  const supported = isNativePlatform() && getPlatform() === "android";
  const ready =
    supported &&
    isNotificationPermissionMoment({
      connectionState,
      interstitialActive,
      tourActive,
      tourOfferPending: shouldOfferTourOnLaunch(loadTourState()),
      playbackActive,
    });

  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      void requestNotificationPermissionOnce();
    }, NOTIFICATION_PERMISSION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return null;
};

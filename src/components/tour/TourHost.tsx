/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useInterstitialActive } from "@/components/ui/interstitial-state";
import {
  loadTourState,
  shouldOfferTourOnLaunch,
  subscribeTourStart,
  type TourStartRequest,
} from "@/lib/tour/tourState";

/**
 * Decides WHETHER the tour runs; the driver, loaded on demand, decides what it does.
 *
 * The two are split so the driver's step descriptors, spotlight geometry and scrim never reach the
 * index bundle. What stays eager is this: a subscription and one localStorage read.
 *
 * The first-launch offer waits for every startup interstitial to go (spec.md section 8.1) — the
 * splash and fade, automatic discovery and the simulated-device offer — because a tour that began
 * under one of them would spotlight a page nobody could see.
 */
const TourDriver = lazy(() => import("@/components/tour/TourDriver"));

/** How long after the last interstitial closes before the tour is offered. */
const SETTLE_MS = 900;

export const TourHost = () => {
  const navigate = useNavigate();
  const interstitialActive = useInterstitialActive();
  const [request, setRequest] = useState<TourStartRequest | null>(null);
  const offeredRef = useRef(false);

  useEffect(() => subscribeTourStart(setRequest), []);

  useEffect(() => {
    if (request !== null || offeredRef.current || interstitialActive) return undefined;
    if (!shouldOfferTourOnLaunch(loadTourState())) return undefined;
    const timer = setTimeout(() => {
      offeredRef.current = true;
      if (window.location.pathname !== "/") navigate("/");
      setRequest({});
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [interstitialActive, navigate, request]);

  if (request === null) return null;

  return (
    <Suspense fallback={null}>
      <TourDriver request={request} onFinished={() => setRequest(null)} />
    </Suspense>
  );
};

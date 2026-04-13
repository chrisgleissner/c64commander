/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import {
  setTraceDeviceAttributionContext,
  setTraceFeatureFlags,
  setTracePlaybackContext,
  setTracePlatformContext,
  setTraceUiContext,
} from "@/lib/tracing/traceContext";
import { getPlatform } from "@/lib/native/platform";
import { registerTraceBridge } from "@/lib/tracing/traceBridge";
import { usePlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";
import {
  buildSavedDeviceDiagnosticsAttribution,
  resolveCanonicalProductFamilyCode,
  type VerifiedSavedDeviceIdentity,
} from "@/lib/savedDevices/store";

export const TraceContextBridge = () => {
  const location = useLocation();
  const { flags } = useFeatureFlags();
  const { status } = useC64Connection();
  const savedDevices = useSavedDevices();
  const playback = usePlaybackTraceSnapshot();
  const selectedSavedDevice =
    savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ??
    savedDevices.devices[0] ??
    null;

  useEffect(() => {
    setTraceUiContext(location.pathname, location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    setTracePlatformContext(getPlatform());
  }, []);

  useEffect(() => {
    setTraceFeatureFlags(flags);
  }, [flags]);

  useEffect(() => {
    setTracePlaybackContext(playback);
  }, [playback]);

  useEffect(() => {
    const verifiedIdentity: VerifiedSavedDeviceIdentity | null = status.deviceInfo
      ? {
          product: resolveCanonicalProductFamilyCode(status.deviceInfo.product ?? null),
          hostname: status.deviceInfo.hostname?.trim() || null,
          uniqueId: status.deviceInfo.unique_id?.trim() || null,
        }
      : null;
    setTraceDeviceAttributionContext(buildSavedDeviceDiagnosticsAttribution(selectedSavedDevice, verifiedIdentity));
  }, [selectedSavedDevice, status.deviceInfo]);

  useEffect(() => {
    registerTraceBridge();
  }, []);

  return null;
};

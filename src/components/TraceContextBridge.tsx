/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useC64Connection } from '@/hooks/useC64Connection';
import {
  setTraceDeviceContext,
  setTraceFeatureFlags,
  setTracePlaybackContext,
  setTracePlatformContext,
  setTraceUiContext,
} from '@/lib/tracing/traceContext';
import { getPlatform } from '@/lib/native/platform';
import { registerTraceBridge } from '@/lib/tracing/traceBridge';
import { usePlaybackTraceSnapshot } from '@/pages/playFiles/playbackTraceStore';

export const TraceContextBridge = () => {
  const location = useLocation();
  const { flags } = useFeatureFlags();
  const { status } = useC64Connection();
  const playback = usePlaybackTraceSnapshot();

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
    setTraceDeviceContext({
      deviceId: status.deviceInfo?.unique_id ?? null,
      connectionState: status.state ?? null,
    });
  }, [status.deviceInfo?.unique_id, status.state]);

  useEffect(() => {
    registerTraceBridge();
  }, []);

  return null;
};

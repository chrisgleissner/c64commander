/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getC64API } from "@/lib/c64api";
import {
  AudioMirrorController,
  type AudioMirrorSnapshot,
  type AudioMirrorDeps,
} from "@/lib/streams/audioMirrorController";

const INITIAL: AudioMirrorSnapshot = { state: "off", droppedPackets: 0, chunks: 0, error: null };

export type UseAudioMirrorOptions = Partial<Pick<AudioMirrorDeps, "createReceiver" | "createPlayer">>;

/**
 * Content Explorer capability D — React binding for the Audio Mirror controller.
 * Starts/stops the device audio stream and plays it in-app; cleans up on unmount.
 */
export const useAudioMirror = (options: UseAudioMirrorOptions = {}) => {
  const [snapshot, setSnapshot] = useState<AudioMirrorSnapshot>(INITIAL);
  const controllerRef = useRef<AudioMirrorController | null>(null);

  const getController = useCallback(() => {
    if (!controllerRef.current) {
      const api = getC64API();
      controllerRef.current = new AudioMirrorController({
        startStream: (name, destination) => api.startStream(name, destination),
        stopStream: (name) => api.stopStream(name),
        onChange: setSnapshot,
        createReceiver: options.createReceiver,
        createPlayer: options.createPlayer,
      });
    }
    return controllerRef.current;
  }, [options.createReceiver, options.createPlayer]);

  const start = useCallback(() => getController().start(), [getController]);
  const stop = useCallback(() => getController().stop(), [getController]);

  useEffect(
    () => () => {
      void controllerRef.current?.stop();
    },
    [],
  );

  return { ...snapshot, start, stop };
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  discoverConnection,
  getConnectionSnapshot,
  noteDeviceUnreachable,
  probeOnce,
  releaseDemoModeChosenWithoutNetwork,
  subscribeConnection,
  type ConnectionState,
} from "@/lib/connection/connectionManager";
import { beginConnectionRevalidation, endConnectionRevalidation } from "@/lib/connection/connectionRevalidation";
import {
  hasLiveAvMirror,
  readAvMirrorRetargetState,
  restartAvMirrorAfterDeviceRetarget,
  stopAvMirrorForDeviceRetarget,
  type AvMirrorRetargetState,
} from "@/lib/connection/deviceRetarget";
import { isLocalPlaybackActive } from "@/lib/playback/activePlaybackSession";
import { getSavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { avMirrorSession, type AvMirrorSnapshot } from "@/lib/streams/avMirrorSession";
import { stopLeftoverDeviceStreams } from "@/lib/streams/leftoverDeviceStreams";
import { isNetworkKnownOffline, recordNetworkStatus, subscribeNetworkEdges } from "@/lib/connection/networkStatusWatch";
import { readNativeNetworkStatus } from "@/lib/connection/offlineStartup";
import { registerUnreachableListener } from "@/lib/connection/reachabilityEvents";
import { addLog } from "@/lib/logging";
import { DeviceDiscovery } from "@/lib/native/deviceDiscovery";

/**
 * Coming home probes the device as soon as the network returns, and again while Wi-Fi settles,
 * rather than at the next background tick (5 s, backing off to 60 s). Leaving shows the device
 * offline at once, so polls stop and its absence is not reported as a fault. A device that stops
 * answering on a working network is confirmed by two probes before it is shown offline.
 */
export const RECONNECT_ATTEMPT_DELAYS_MS = [0, 500, 1000, 2000, 4000, 8000] as const;
export const UNREACHABLE_CONFIRM_DELAYS_MS = [0, 2000] as const;

const isMirrorLive = (state: string) => state === "connecting" || state === "live";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let reconnectRun = 0;

export const reconnectWhenNetworkReturns = async () => {
  const run = ++reconnectRun;
  if (!isNetworkKnownOffline() && releaseDemoModeChosenWithoutNetwork()) {
    addLog("info", "Network is back; looking for the real device again after Demo Mode chosen without one");
  }
  for (const delayMs of RECONNECT_ATTEMPT_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    if (run !== reconnectRun || isNetworkKnownOffline()) return;
    const { state } = getConnectionSnapshot();
    if (state === "REAL_CONNECTED") return;
    if (state !== "OFFLINE_NO_DEMO" && state !== "DEMO_ACTIVE") continue;
    await discoverConnection("background");
  }
};

// Live View is put down while the device is out of reach and picked up again when it answers. The
// stream socket can close with the network a moment before the event arrives, so a mirror that was
// live within MIRROR_OUTAGE_GRACE_MS still counts as on.
export const MIRROR_OUTAGE_GRACE_MS = 3000;
let mirrorBeforeOutage: AvMirrorRetargetState | null = null;
const mirrorEndedAt = { video: 0, audio: 0 };
let mirrorWasLive = { video: false, audio: false };

const trackMirror = (snapshot: AvMirrorSnapshot) => {
  const live = { video: isMirrorLive(snapshot.video.state), audio: isMirrorLive(snapshot.audio.state) };
  if (mirrorWasLive.video && !live.video) mirrorEndedAt.video = Date.now();
  if (mirrorWasLive.audio && !live.audio) mirrorEndedAt.audio = Date.now();
  mirrorWasLive = live;
};

const readMirrorBeforeOutage = (): AvMirrorRetargetState => {
  const current = readAvMirrorRetargetState();
  const recently = (endedAt: number) => Date.now() - endedAt <= MIRROR_OUTAGE_GRACE_MS;
  return {
    videoWasLive: current.videoWasLive || recently(mirrorEndedAt.video),
    audioWasLive: current.audioWasLive || recently(mirrorEndedAt.audio),
  };
};

const showDeviceOffline = async (reason: "network-lost" | "not-answering") => {
  if (getConnectionSnapshot().state !== "REAL_CONNECTED") return;
  const mirror = readMirrorBeforeOutage();
  if (hasLiveAvMirror(mirror)) {
    mirrorBeforeOutage = mirror;
    void stopAvMirrorForDeviceRetarget(getSavedDevicesSnapshot().selectedDeviceId);
  }
  await noteDeviceUnreachable(reason);
};

/** Live View the app kept off while the device was out of reach comes back with the device. */
export const restoreMirrorWhenDeviceReturns = (state: AvMirrorRetargetState) => {
  mirrorBeforeOutage = {
    videoWasLive: state.videoWasLive || Boolean(mirrorBeforeOutage?.videoWasLive),
    audioWasLive: state.audioWasLive || Boolean(mirrorBeforeOutage?.audioWasLive),
  };
};

// Only on the way back in: the transition out also emits snapshots while the state still reads connected.
let lastConnectionState: ConnectionState = "UNKNOWN";

const resumeMirrorAfterOutage = () => {
  const { state } = getConnectionSnapshot();
  const reconnected = state === "REAL_CONNECTED" && lastConnectionState !== "REAL_CONNECTED";
  lastConnectionState = state;
  if (!reconnected) return;
  const mirror = mirrorBeforeOutage;
  mirrorBeforeOutage = null;
  if (hasLiveAvMirror(readAvMirrorRetargetState())) return;
  void (async () => {
    // The stop sent as the device went out of reach never arrived, so the device may still be streaming.
    await stopLeftoverDeviceStreams();
    if (!mirror || hasLiveAvMirror(readAvMirrorRetargetState())) return;
    // A tune that carried on on the phone while away keeps the speaker; the C64's audio returns with the next track.
    const audioWasLive = mirror.audioWasLive && !isLocalPlaybackActive();
    restartAvMirrorAfterDeviceRetarget(
      { ...mirror, audioWasLive },
      getSavedDevicesSnapshot().selectedDeviceId ?? "selected",
      getConnectionSnapshot().deviceInfo,
    );
  })();
};

let confirmingUnreachable = false;

export const confirmDeviceUnreachable = async () => {
  if (confirmingUnreachable || getConnectionSnapshot().state !== "REAL_CONNECTED") return;
  if (isNetworkKnownOffline()) {
    await showDeviceOffline("network-lost");
    return;
  }
  confirmingUnreachable = true;
  try {
    for (const delayMs of UNREACHABLE_CONFIRM_DELAYS_MS) {
      if (delayMs > 0) await wait(delayMs);
      if (getConnectionSnapshot().state !== "REAL_CONNECTED") return;
      if (await probeOnce()) return;
    }
    await showDeviceOffline("not-answering");
  } finally {
    confirmingUnreachable = false;
  }
};

const handleNetworkEdge = (edge: "online" | "offline") => {
  addLog("info", edge === "offline" ? "Network lost on this device" : "Network available on this device");
  if (edge === "offline") {
    reconnectRun += 1;
    void showDeviceOffline("network-lost");
    return;
  }
  void reconnectWhenNetworkReturns();
};

/**
 * Check a connection the app has come back to, rather than carrying on asserting it. Nothing
 * probes the device while the state reads REAL_CONNECTED — the background schedule stops there and
 * only a failing request corrects it — so a phone that spent an hour in a pocket came back
 * claiming the machine was reachable, and stayed wrong until the user pressed something that failed.
 */
export const revalidateConnectionOnResume = async () => {
  if (getConnectionSnapshot().state !== "REAL_CONNECTED") return;
  if (!beginConnectionRevalidation()) return;
  try {
    if (isNetworkKnownOffline()) {
      await showDeviceOffline("network-lost");
      return;
    }
    if (await probeOnce()) return;
    await confirmDeviceUnreachable();
  } finally {
    endConnectionRevalidation();
  }
};

// A hidden WebView may not run the listener when the network changes, so the answer is read again on return.
const handleVisibilityChange = () => {
  if (document.visibilityState !== "visible") return;
  void readNativeNetworkStatus().then(() => {
    const { state } = getConnectionSnapshot();
    if (!isNetworkKnownOffline() && (state === "OFFLINE_NO_DEMO" || state === "DEMO_ACTIVE")) {
      void reconnectWhenNetworkReturns();
      return;
    }
    if (state === "REAL_CONNECTED") void revalidateConnectionOnResume();
  });
};

export const installNetworkTransitions = () => {
  endConnectionRevalidation();
  lastConnectionState = getConnectionSnapshot().state;
  const unsubscribeEdges = subscribeNetworkEdges(handleNetworkEdge);
  const unsubscribeConnection = subscribeConnection(resumeMirrorAfterOutage);
  const unsubscribeMirror = avMirrorSession.subscribe(trackMirror);
  const unregisterUnreachable = registerUnreachableListener(() => {
    void confirmDeviceUnreachable();
  });
  let removeNativeListener: (() => void) | null = null;
  let disposed = false;
  const noteEventsUnavailable = (error: unknown) =>
    addLog("info", "Network change events are unavailable; reconnection relies on background probes", {
      error: error instanceof Error ? error.message : String(error),
    });
  try {
    void DeviceDiscovery.addListener("networkStatusChange", recordNetworkStatus)
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeNativeListener = () => void handle.remove();
      })
      .catch(noteEventsUnavailable);
  } catch (error) {
    noteEventsUnavailable(error);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    disposed = true;
    reconnectRun += 1;
    unsubscribeEdges();
    unsubscribeConnection();
    unsubscribeMirror();
    unregisterUnreachable();
    removeNativeListener?.();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};

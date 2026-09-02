/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { stopStreamAtHost } from "./foreignSenderStop";

/**
 * Stop a stream the *device* was still sending when this app last went away.
 *
 * `silenceLeftoverNativeAudio` closes the app's own sockets and AudioTrack at launch, which fixes
 * what the phone is doing. It says nothing about the Ultimate: `streams:start` puts the firmware
 * into a state that only `streams:stop` leaves. If Android kills the process while Live View is on
 * — a low-memory kill, a crash, "Force stop" — the stop never runs and the machine keeps
 * multicasting video and audio into the LAN indefinitely, at ~2.6 MB/s for video.
 *
 * The firmware has no endpoint that reports its current stream targets (`/v1/streams/{s}:start` and
 * `:stop` are the whole surface), so the app cannot ask. It has to remember instead: record the host
 * a stream was started on, clear the record when the stop succeeds, and sweep whatever is left at
 * the next launch.
 */

const LEFTOVER_STREAMS_KEY = "c64u_device_streams_running";

export type LeftoverStreamName = "audio" | "video";

type LeftoverRecord = Partial<Record<LeftoverStreamName, string>>;

const readRecord = (): LeftoverRecord => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LEFTOVER_STREAMS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const record: LeftoverRecord = {};
    for (const name of ["audio", "video"] as const) {
      const host = (parsed as Record<string, unknown>)[name];
      if (typeof host === "string" && host.trim()) record[name] = host.trim();
    }
    return record;
  } catch {
    return {};
  }
};

const writeRecord = (record: LeftoverRecord): void => {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(record).length === 0) localStorage.removeItem(LEFTOVER_STREAMS_KEY);
    else localStorage.setItem(LEFTOVER_STREAMS_KEY, JSON.stringify(record));
  } catch {
    // A full or unavailable localStorage must never break starting or stopping a stream.
  }
};

/** Called after `streams:{name}:start` succeeds against `host`. */
export const recordDeviceStreamStarted = (name: LeftoverStreamName, host: string | null | undefined): void => {
  const trimmed = host?.trim();
  if (!trimmed) return;
  writeRecord({ ...readRecord(), [name]: trimmed });
};

/**
 * Called after `streams:{name}:stop` succeeds.
 *
 * Only on success: a stop that threw may well have left the device streaming, which is exactly the
 * state the launch sweep exists to clean up.
 */
export const recordDeviceStreamStopped = (name: LeftoverStreamName): void => {
  const record = readRecord();
  if (!(name in record)) return;
  delete record[name];
  writeRecord(record);
};

export const getLeftoverDeviceStreamsForTests = (): LeftoverRecord => readRecord();

/**
 * Tell the device to stop anything this app left running, then forget it.
 *
 * The record is cleared whether or not the stop succeeds. Retrying at every launch would mean an
 * unreachable or retired machine costing a request timeout on each start for as long as the entry
 * survives, and the case it would buy — the machine is off now and will come back still streaming —
 * does not happen, because the streams do not survive the device losing power.
 */
export const stopLeftoverDeviceStreams = async (): Promise<void> => {
  const record = readRecord();
  const entries = Object.entries(record) as [LeftoverStreamName, string][];
  if (entries.length === 0) return;
  writeRecord({});
  await Promise.all(
    entries.map(async ([name, host]) => {
      try {
        await stopStreamAtHost(host, name);
        addLog("info", `Live View: stopped a ${name} stream left running on the device`, {
          service: "streams",
          host,
        });
      } catch (error) {
        addLog("warn", `Live View: could not stop the ${name} stream left running on the device`, {
          service: "streams",
          host,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
};

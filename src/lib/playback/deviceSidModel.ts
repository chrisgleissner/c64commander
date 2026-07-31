/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Learn which SID revision the connected Ultimate has, so on-device playback can fall back to the
 * same chip the listener's own machine would have used.
 *
 * Everything here runs off the playback path. It reads the live config tree, stores what it found,
 * and the engine reads only what is stored — so a machine that is off or unreachable never delays
 * a tune by so much as a request.
 */

import type { C64API } from "@/lib/c64api";
import { getConfigCategoryItems } from "@/lib/config/validateConfigWrite";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { saveLearnedDeviceSidModel, type LocalSidModel } from "@/lib/config/appSettings";
import { addLog } from "@/lib/logging";

/** The category listing every socket's presence, detected chip and passive component choices. */
export const SID_SOCKETS_CATEGORY = "SID Sockets Configuration";

/**
 * The item a programmable SID replacement uses to say which chip it is imitating.
 *
 * An ARMSID, ARM2SID, FPGASID or SwinSID can be either revision, so the socket's *detected* value
 * names the replacement rather than a chip, and the actual revision lives in the per-socket
 * category the firmware publishes for it (`SID Socket 1: ARMSID`, verified against a C64U on
 * firmware 1.1.0).
 */
const FUNDAMENTAL_MODE_ITEM = "Fundamental Mode";

/** Where a reading came from, for the line the Settings screen shows the user. */
export interface DeviceSidModelReading {
  model: LocalSidModel;
  /** Human-readable provenance, e.g. `SID Socket 1` — shown in Settings so the value is checkable. */
  source: string;
}

const asModel = (value: unknown): LocalSidModel | null => {
  const text = String(value ?? "").trim();
  return text === "6581" || text === "8580" ? text : null;
};

const itemValue = (payload: unknown, category: string, item: string): unknown => {
  const items = getConfigCategoryItems(payload, category);
  if (!Object.prototype.hasOwnProperty.call(items, item)) return undefined;
  return normalizeConfigItem(items[item]).value;
};

/**
 * The revision a per-socket category reports.
 *
 * Prefers the item the firmware actually names, and otherwise takes the only item in the category
 * whose *value* is a bare revision. The fallback matters because the per-socket category differs
 * per replacement chip, and reading the value rather than the item name keeps a differently-named
 * item working: the neighbouring items are filter settings whose values are strengths, frequencies
 * and levels, never a bare `6581` or `8580`.
 */
export const sidModelFromSocketCategory = (payload: unknown, category: string): LocalSidModel | null => {
  const named = asModel(itemValue(payload, category, FUNDAMENTAL_MODE_ITEM));
  if (named) return named;
  const items = getConfigCategoryItems(payload, category);
  for (const raw of Object.values(items)) {
    const model = asModel(normalizeConfigItem(raw).value);
    if (model) return model;
  }
  return null;
};

/**
 * Pick the socket whose chip should stand for "the SID in this machine".
 *
 * Socket 1 before socket 2, because socket 1 is the machine's primary SID — the chip a tune that
 * declares one address writes to, and the only one a single-chip tune ever reaches. A disabled
 * socket is skipped: its chip is out of the audio path, so it says nothing about what the machine
 * sounds like. This is a real distinction rather than a hypothetical one; the C64U this was built
 * against has a 6581 in socket 1 and an 8580 in socket 2.
 *
 * The `UltiSID` FPGA chips are deliberately not consulted. Their character is spread over four
 * independent items — filter curve, resonance, combined waveforms, digis level — which can name
 * different revisions at the same time (that machine reports an `8580 Lo` filter curve alongside
 * `6581` combined waveforms) and can name none at all (`U2 Mid`). Any single revision derived from
 * that set would be a guess, and a guess presented to the user as "the chip in your C64" is worse
 * than falling back to the choice they made themselves.
 */
export const resolveSocketSidModel = (
  socketsPayload: unknown,
  socketDetail: (socket: 1 | 2) => unknown,
): DeviceSidModelReading | null => {
  for (const socket of [1, 2] as const) {
    const enabled = String(itemValue(socketsPayload, SID_SOCKETS_CATEGORY, `SID Socket ${socket}`) ?? "").trim();
    if (enabled.toLowerCase() !== "enabled") continue;
    const source = `SID Socket ${socket}`;
    const detected = itemValue(socketsPayload, SID_SOCKETS_CATEGORY, `SID Detected Socket ${socket}`);
    const direct = asModel(detected);
    if (direct) return { model: direct, source };
    const detail = socketDetail(socket);
    if (detail === undefined) continue;
    const model = sidModelFromSocketCategory(detail, socketDetailCategory(socket, detected));
    if (model) return { model, source };
  }
  return null;
};

/**
 * The category name the firmware publishes for one socket's replacement chip.
 *
 * Built from the chip the device itself reported rather than from a table of names, so a
 * replacement this app has never heard of is still readable.
 */
export const socketDetailCategory = (socket: 1 | 2, detected: unknown): string =>
  `SID Socket ${socket}: ${String(detected ?? "").trim()}`;

const isMissingCategory = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { c64uHttpStatus?: number }).c64uHttpStatus === 404;

/**
 * Read the connected machine's SID revision.
 *
 * Sequential rather than parallel, and at most three requests: the C64U firmware's TCP stack is
 * fragile under a burst after idle, and this is background curiosity, not something anyone is
 * waiting for. Returns `null` when the machine has no chip to report — an Ultimate whose sockets
 * are empty plays everything on its FPGA SIDs, and those cannot answer the question (see
 * {@link resolveSocketSidModel}).
 */
export const readDeviceSidModel = async (api: C64API): Promise<DeviceSidModelReading | null> => {
  const socketsPayload = await api.getCategory(SID_SOCKETS_CATEGORY, { __c64uIntent: "background" });
  const details = new Map<1 | 2, unknown>();
  for (const socket of [1, 2] as const) {
    const enabled = String(itemValue(socketsPayload, SID_SOCKETS_CATEGORY, `SID Socket ${socket}`) ?? "").trim();
    if (enabled.toLowerCase() !== "enabled") continue;
    const detected = itemValue(socketsPayload, SID_SOCKETS_CATEGORY, `SID Detected Socket ${socket}`);
    // A socket that already names a revision needs nothing more, and a socket that reports nothing
    // at all has no category to read.
    if (asModel(detected) || !String(detected ?? "").trim()) continue;
    try {
      details.set(
        socket,
        await api.getCategory(socketDetailCategory(socket, detected), { __c64uIntent: "background" }),
      );
    } catch (error) {
      // A firmware that does not publish this socket's category is not a failure — it only means
      // this socket cannot say which revision it is, and the next one may still be able to.
      if (!isMissingCategory(error)) throw error;
      addLog("debug", "No per-socket SID category on this firmware", {
        service: "local-sid",
        socket,
        detected: String(detected ?? ""),
      });
    }
  }
  return resolveSocketSidModel(socketsPayload, (socket) => details.get(socket));
};

/**
 * Learn the connected machine's SID revision and remember it.
 *
 * Never throws: this is a convenience that improves how a tune sounds, and no part of the app
 * should fail because a machine would not answer. A reading is only ever replaced by another
 * reading — an unreachable or SID-less machine leaves the remembered value alone, which is what
 * makes the setting keep working away from the C64.
 */
export const syncDeviceSidModel = async (api: C64API): Promise<DeviceSidModelReading | null> => {
  try {
    const reading = await readDeviceSidModel(api);
    if (reading) saveLearnedDeviceSidModel(reading.model);
    return reading;
  } catch (error) {
    addLog("debug", "Could not read the SID model from the connected device", {
      service: "local-sid",
      error: (error as Error)?.message ?? String(error),
    });
    return null;
  }
};

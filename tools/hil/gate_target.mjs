/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which phone the hardware merge gate drives, and which of its stages that phone can run.
 *
 * Two phones serve the gate. The keypad handset is the constrained target of the `c64u-remote`
 * edition: a compact screen, a physical keypad, and Android apps in a container on a Linux phone,
 * reached through droidctl's ssh transport. The Pixel 4 runs the default edition and stays the
 * phone for normal-phone behaviour, and the fallback when the handset is absent. HIL runs go to
 * the handset whenever it is attached.
 *
 * Pure, so the selection rules and the per-stage verdicts are unit-tested without a device.
 */

import { chooseTarget } from "./droidctl_device.mjs";

export const GATE_TARGET_MODES = ["auto", "handset", "pixel"];

/** The application each phone runs, and the activity both editions share. */
export const HANDSET_PACKAGE = "uk.gleissner.c64uremote";
export const PIXEL_PACKAGE = "uk.gleissner.c64commander";

/** A phone reached through droidctl's ssh transport, which the keypad handset is. */
export const isHandsetTarget = (target) => target.transport === "ssh";

/**
 * Pick the phone for `mode`.
 *
 * - `handset`: the handset, or an error naming what is attached instead.
 * - `pixel`: an adb phone, chosen by the rules every other harness uses, so a handset attached
 *   alongside never changes which phone a Pixel run drives.
 * - `auto`: the handset when it is attached and ready, otherwise the Pixel rules.
 *
 * An explicit serial wins over the mode, and the target kind then follows from the transport.
 */
export const resolveGateTarget = (targets, { mode = "auto", serial = "" } = {}) => {
  if (!GATE_TARGET_MODES.includes(mode)) {
    throw new Error(`--target must be one of ${GATE_TARGET_MODES.join(", ")} (got "${mode}")`);
  }
  const describe = (target) => {
    const handset = isHandsetTarget(target);
    return {
      kind: handset ? "handset" : "pixel",
      serial: target.serial,
      targetId: target.targetId,
      packageName: handset ? HANDSET_PACKAGE : PIXEL_PACKAGE,
    };
  };
  if (serial) return describe(chooseTarget(targets, serial));

  const handsets = targets.filter((target) => isHandsetTarget(target) && target.state === "device");
  if (mode === "handset" || (mode === "auto" && handsets.length > 0)) {
    if (handsets.length === 1) return describe(handsets[0]);
    if (handsets.length === 0) {
      const listed = targets.filter(isHandsetTarget).map((t) => `${t.serial} (${t.state})`);
      throw new Error(
        `no keypad handset is ready${listed.length ? `; listed but not ready: ${listed.join(", ")}` : ""}`,
      );
    }
    throw new Error(`several handsets are attached (${handsets.map((t) => t.serial).join(", ")}); pass --serial`);
  }
  return describe(chooseTarget(targets.filter((target) => !isHandsetTarget(target))));
};

/**
 * Why a stage cannot run on a target kind, or null when it can.
 *
 * The microphone sits in front of the Pixel's speaker, so every stage graded from a recording
 * belongs to that phone. The crossfade stage grades the app's own PCM instead, but it steps the
 * phone's media volume with key events to keep the room quiet, and the handset's volume belongs
 * to the host system rather than to the Android container the gate drives. A stage skipped for
 * either reason is reported as skipped with that reason, never as a pass.
 */
export const HANDSET_EXCLUSIONS = {
  "av-clarity": "not runnable on this target (no microphone at its speaker)",
  "av-latency": "not runnable on this target (no microphone at its speaker)",
  "sid-remote": "not runnable on this target (no microphone at its speaker)",
  "sid-local": "not runnable on this target (no microphone at its speaker)",
  crossfade: "not runnable on this target (its media volume is not under the gate's control)",
};

export const stageExclusion = (stageName, kind) =>
  kind === "handset" ? (HANDSET_EXCLUSIONS[stageName] ?? null) : null;

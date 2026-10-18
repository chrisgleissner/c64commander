/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which phone the hardware merge gate drives for each stage, and what it does on each phone.
 *
 * Two phones serve the gate. The keypad handset is the constrained target of the `c64u-remote`
 * edition: a compact screen, a physical keypad, and Android apps in a container on a Linux phone,
 * reached through droidctl's ssh transport. The Pixel 4 runs the default edition, stays the phone
 * for normal-phone behaviour, and carries the microphone. HIL runs go to the handset whenever it
 * is attached; a stage it cannot run goes to the Pixel, and fails the run when no Pixel is there
 * unless the caller asked for a handset-only run.
 *
 * Pure, so every decision is unit-tested without a device.
 */

import { chooseTarget } from "./droidctl_device.mjs";

export const GATE_TARGET_MODES = ["auto", "handset", "pixel"];

/** The application each phone runs. Both editions share the launch activity. */
export const HANDSET_PACKAGE = "uk.gleissner.c64uremote";
export const PIXEL_PACKAGE = "uk.gleissner.c64commander";

/**
 * The stages that ran on `main` without droidctl: they talk to the page over an existing DevTools
 * forward and to the Ultimate over the network. A run that names only these does not resolve a
 * phone, so it keeps working on a checkout where droidctl has not been built.
 */
export const DROIDCTL_FREE_STAGES = ["search-latency", "wire"];

/**
 * A phone reached through droidctl's ssh transport that the gate can drive: only the container-adb
 * route forwards the WebView; the attach route lists the phone as ready and refuses the forward.
 */
export const isHandsetTarget = (target) => target.transport === "ssh";
const isDrivableHandset = (target) =>
  isHandsetTarget(target) && target.state === "device" && target.route === "container-adb";

/** droidctl's own tunnel to the handset's container appears to adb as a local network serial. */
const isLocalTunnelSerial = (serial) => /^(127\.0\.0\.1|localhost):\d+$/.test(serial);

const describe = (target) => {
  const handset = isHandsetTarget(target);
  return {
    kind: handset ? "handset" : "pixel",
    serial: target.serial,
    targetId: target.targetId,
    packageName: handset ? HANDSET_PACKAGE : PIXEL_PACKAGE,
  };
};

/** An adb phone by the rules every harness uses, never the handset or a tunnel to it. */
const choosePixel = (targets) =>
  chooseTarget(targets.filter((target) => !isHandsetTarget(target) && !isLocalTunnelSerial(target.serial)));

/**
 * The phones a run will use: `{ handset, pixel, handsetOnly }`, either phone possibly null.
 *
 * - `auto`: the handset when it is drivable, and the Pixel too when one is attached, so the stages
 *   the handset cannot run still run.
 * - `handset`: the handset alone; stages it cannot run are skipped, by request (`handsetOnly`).
 * - `pixel`: the Pixel alone, chosen as before; a handset attached alongside never changes it.
 * - A serial picks one phone; a `--target` the serial contradicts is refused rather than guessed at.
 * - An ssh transport that could not be probed (`transportErrors`) means the handset cannot be ruled
 *   out, so the plan is refused instead of quietly grading the Pixel alone.
 */
export const resolveGatePlan = (
  targets,
  { mode = "auto", modeExplicit = false, serial = "", transportErrors = [] } = {},
) => {
  if (!GATE_TARGET_MODES.includes(mode)) {
    throw new Error(`--target must be one of ${GATE_TARGET_MODES.join(", ")} (got "${mode}")`);
  }
  if (serial) {
    const chosen = describe(chooseTarget(targets, serial));
    if (modeExplicit && mode !== "auto" && mode !== chosen.kind) {
      throw new Error(`--target ${mode} contradicts the serial ${serial}, which is the ${chosen.kind}`);
    }
    return chosen.kind === "handset"
      ? { handset: chosen, pixel: null, handsetOnly: true }
      : { handset: null, pixel: chosen, handsetOnly: false };
  }
  if (mode === "pixel") return { handset: null, pixel: describe(choosePixel(targets)), handsetOnly: false };

  const sshErrors = transportErrors.filter((entry) => entry.transport === "ssh");
  if (sshErrors.length && !targets.some(isDrivableHandset)) {
    throw new Error(
      `the ssh transport could not list the keypad handset: ${sshErrors.map((entry) => entry.message).join("; ")}`,
    );
  }
  const handsets = targets.filter(isDrivableHandset);
  if (handsets.length > 1) {
    throw new Error(`several handsets are attached (${handsets.map((t) => t.serial).join(", ")}); pass --serial`);
  }
  const handset = handsets.length === 1 ? describe(handsets[0]) : null;
  if (mode === "handset") {
    if (handset) return { handset, pixel: null, handsetOnly: true };
    const listed = targets.filter(isHandsetTarget).map((t) => `${t.serial} (${t.state}, route ${t.route ?? "none"})`);
    throw new Error(
      `no keypad handset is drivable${listed.length ? `; listed but not drivable: ${listed.join(", ")}` : ""}`,
    );
  }
  let pixel = null;
  try {
    pixel = describe(choosePixel(targets));
  } catch (error) {
    if (!handset) throw error;
  }
  return { handset, pixel, handsetOnly: false };
};

/**
 * Why a stage cannot run on the handset, or null when it can. The microphone sits in front of the
 * Pixel's speaker, so every stage graded from a recording belongs there. `crossfade` grades the
 * app's own PCM instead, but steps the phone's media volume to keep the room quiet, and the
 * handset's volume belongs to its host system rather than to the container the gate drives.
 */
export const HANDSET_EXCLUSIONS = {
  "av-clarity": "not runnable on the handset (no microphone at its speaker)",
  "av-latency": "not runnable on the handset (no microphone at its speaker)",
  "sid-remote": "not runnable on the handset (no microphone at its speaker)",
  "sid-local": "not runnable on the handset (no microphone at its speaker)",
  crossfade: "not runnable on the handset (its media volume is not under the gate's control)",
};

/**
 * Where a stage runs: `{ phone }` naming "handset" or "pixel", or `{ verdict }` when it cannot run.
 *
 * A stage the handset can run runs there. One it cannot runs on the Pixel. With no Pixel it is
 * skipped only when the caller asked for a handset-only run, and fails otherwise: the default run
 * must not report a pass for stages nobody measured.
 */
export const stagePlacement = (stage, { handset, pixel, handsetOnly }) => {
  const exclusion = HANDSET_EXCLUSIONS[stage] ?? null;
  if (handset && !exclusion) return { phone: "handset" };
  if (pixel) return { phone: "pixel" };
  if (handsetOnly) return { verdict: { status: "skipped", detail: exclusion } };
  return {
    verdict: {
      status: "fail",
      detail: `${exclusion}, and no Pixel is attached to run it; pass --target handset to accept a handset-only run`,
    },
  };
};

/** The phones in the order a run visits them, each with the stages placed on it. */
export const phasesFor = (plan, stages) =>
  ["handset", "pixel"]
    .map((phone) => ({ phone, stages: stages.filter((stage) => stagePlacement(stage, plan).phone === phone) }))
    .filter((phase) => phase.stages.length > 0);

/**
 * Whether the gate reads, steps and restores the phone's media volume. On the handset it does
 * none of them: the volume there belongs to the host system, and no stage that needs it runs there.
 */
export const controlsVolume = (kind) => kind === "pixel";

/** The joystick layout the input stage exercises: the one each edition ships as its default. */
export const inputLayoutFor = (kind) => (kind === "handset" ? "diamond8" : "classicT9");

/**
 * Point the DevTools forward at this phone's app before any stage reads the page through it, on
 * both kinds: a forward left from a run on the other phone would otherwise grade the wrong app.
 */
export const preparePhone = async (device, phone, port) => {
  await device.forwardWebview(phone.packageName, Number(port));
};

/** Refuse a page that belongs to another application id than the phone's own edition. */
export const assertPageApp = (appId, phone) => {
  if (appId !== phone.packageName) {
    throw new Error(
      `the DevTools forward reaches ${appId || "an unknown app"}, not ${phone.packageName} on the ${phone.kind}`,
    );
  }
};

/**
 * Run a plan: record a verdict for every stage no phone can run, then visit each phone in turn,
 * binding it, forwarding its WebView, preflighting it, running its stages and putting it back.
 *
 * The phone work is done through `hooks`, so the order and the rules are tested without a device:
 * `record(name, verdict)`, `bind(phone | null)`, `prepare(phone)`, `preflight(phone)` (resolves to
 * false when the rig failed it), `runStage(name, phone)` and `restore(phone)`. A failed preflight
 * stops the run there, because nothing after it would mean anything.
 */
export const runPhases = async ({ plan, selected, wantPreflight, hooks }) => {
  for (const name of selected) {
    const placement = stagePlacement(name, plan);
    if (placement.verdict) hooks.record(name, placement.verdict);
  }
  const phases = phasesFor(plan, selected);
  if (!phases.length && wantPreflight) {
    for (const kind of ["handset", "pixel"]) if (plan[kind]) phases.push({ phone: kind, stages: [] });
  }
  try {
    for (const phase of phases) {
      const phone = plan[phase.phone];
      await hooks.bind(phone);
      await hooks.prepare(phone);
      if (wantPreflight && !(await hooks.preflight(phone))) return { aborted: phone.kind };
      for (const name of phase.stages) await hooks.runStage(name, phone);
      await hooks.restore(phone);
    }
  } finally {
    await hooks.bind(null);
  }
  return { aborted: null };
};

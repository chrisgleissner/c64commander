/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigResponse, MachineInputBatch } from "@/lib/c64api";
import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import { AUDIO_MIXER_MASTER_VOLUME_ITEM } from "@/lib/config/configItems";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { isSidVolumeOffValue } from "@/lib/config/sidVolumeControl";
import { addErrorLog, addLog } from "@/lib/logging";
import { remoteSeekErrorDetails as errorDetails, RemoteSeekSessionClosedError } from "./remoteSeekErrors";
import { grantSeekKeyPress } from "./seekKeyPermit";
import {
  FAST_FORWARD_HELD,
  FAST_FORWARD_RELEASED,
  isFastForwardPatchStillThere,
  patchRoutineDifferences,
  type PatchRoutine,
} from "./sidPlayerFastForwardPatch";

export { RemoteSeekSessionClosedError };

/** The SID player was not on screen when a seek was about to press a key or write the patch. */
export class RemoteSeekPlayerGoneError extends Error {}

/**
 * A REST-held key and a CPU Speed stay until written again, and a C64 left at 64 MHz breaks every game. So the
 * originals are journalled before the first change, the journal is cleared only after a read-back confirms the restore,
 * and a journal left by a crash or a killed app is replayed when the app reaches the device.
 */

export const U64_SETTINGS_CATEGORY = "U64 Specific Settings";
export const AUDIO_MIXER_CATEGORY = "Audio Mixer";
export const CPU_SPEED_ITEM = "CPU Speed";
export const TURBO_CONTROL_ITEM = "Turbo Control";
export const SYSTEM_MODE_ITEM = "System Mode";
export const FAST_FORWARD_KEY = "arrow_left" as const;
const MANUAL_TURBO_CONTROL = "Manual";
const JOURNAL_STORAGE_KEY = "c64u_remote_seek_device_journal_v1";
/** Waits before each restore attempt; the total stays inside a few seconds of a dropped connection. */
export const RESTORE_RETRY_DELAYS_MS = [0, 400, 1200, 3000] as const;

export type RemoteSeekDeviceApi = {
  /** The identity key of the device the API talks to now, or null while that is unknown. */
  currentDeviceKey: () => string | null;
  getConfigItem: (
    category: string,
    item: string,
    options?: { __c64uIntent?: InteractionIntent; __c64uBypassCache?: boolean },
  ) => Promise<ConfigResponse>;
  setConfigValue: (
    category: string,
    item: string,
    value: string | number,
    options?: { __c64uTransientConfigWrite?: boolean; __c64uTransientConfigRestore?: boolean },
  ) => Promise<ConfigResponse>;
  sendMachineInputBatch: (batch: MachineInputBatch) => Promise<unknown>;
  getMachineInputState: () => Promise<{ keyboard?: { inputs?: string[] } }>;
  readMemory: (
    address: string,
    length: number,
    options?: { __c64uBypassCooldown?: boolean; __c64uIntent?: InteractionIntent },
  ) => Promise<Uint8Array>;
  writeMemory: (address: string, data: Uint8Array) => Promise<unknown>;
};

/**
 * How a seek holds fast forward: the left-arrow key through machine:input, or, on a machine that
 * takes no key input, one byte of the player's keyboard routine (see sidPlayerFastForwardPatch.ts).
 */
export type FastForwardMethod = { kind: "key" } | { kind: "patch"; ldyOperandAddress: number; routine: PatchRoutine };

export type RemoteSeekJournal = {
  /** Which session wrote it: a restore clears the journal only if it is still its own. */
  sessionId: string;
  deviceKey: string;
  originalCpuSpeed: string;
  cpuSpeedChanged: boolean;
  /** Recorded only when the seek switched Turbo Control, so a restore never writes it needlessly. */
  originalTurboControl: string | null;
  keyHeld: boolean;
  /** `Vol Master` before a rewind turned it off; absent when nothing was muted, and in older journals. */
  originalMasterVolume?: string | null;
  /** Set when fast forward is held through the player's code instead of the key; absent in older journals. */
  fastForwardPatch?: PatchSite | null;
  startedAtMs: number;
};

export type ConfigItemSnapshot = { value: string; options: string[] };

type JournalStore = Record<string, RemoteSeekJournal>;

const readJournalStore = (): JournalStore => {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as JournalStore) : {};
  } catch (error) {
    addErrorLog("Remote seek journal could not be read", errorDetails(error));
    return {};
  }
};

/** The unfinished seek recorded for a device, or null when it owes nothing. */
export const readRemoteSeekJournal = (deviceKey: string): RemoteSeekJournal | null =>
  readJournalStore()[deviceKey] ?? null;

export const hasRemoteSeekJournal = (): boolean => Object.keys(readJournalStore()).length > 0;

/**
 * Record what a seek is about to change. Throws when that cannot be stored, so the change is not made:
 * a killed app would leave it behind with nothing to replay.
 */
const writeJournal = (deviceKey: string, journal: RemoteSeekJournal | null) => {
  try {
    const store = readJournalStore();
    if (journal === null) delete store[deviceKey];
    else store[deviceKey] = journal;
    if (Object.keys(store).length === 0) localStorage.removeItem(JOURNAL_STORAGE_KEY);
    else localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    if (journal === null) {
      addErrorLog("Remote seek journal could not be cleared", { ...errorDetails(error), deviceKey });
      return;
    }
    throw new Error(`The remote seek journal could not be stored, so the seek changed nothing: ${String(error)}`, {
      cause: error,
    });
  }
};

const clearJournalIfOwn = (journal: RemoteSeekJournal) => {
  if (readRemoteSeekJournal(journal.deviceKey)?.sessionId === journal.sessionId) writeJournal(journal.deviceKey, null);
};

/** Sessions open in this process, by device. Their journals are theirs to restore, not recovery's. */
const liveSessions = new Map<string, RemoteSeekDeviceSession>();
let sessionCounter = 0;

/** The current value and options of one config item, read from the device itself. */
class ConfigItemMissingError extends Error {}

/** A machine without the item at all, such as the Ultimate-II+(L) without an Audio Mixer, answers 404. */
const isMissingItem = (error: unknown) => error instanceof ConfigItemMissingError || /HTTP 404\b/.test(String(error));

const readConfigItem = async (
  api: RemoteSeekDeviceApi,
  categoryName: string,
  item: string,
): Promise<ConfigItemSnapshot> => {
  const response = await api.getConfigItem(categoryName, item, { __c64uIntent: "user", __c64uBypassCache: true });
  const category = response[categoryName] as Record<string, unknown> | undefined;
  const raw = category?.[item] ?? (category?.items as Record<string, unknown> | undefined)?.[item];
  if (raw === undefined) throw new ConfigItemMissingError(`${categoryName} / ${item} is not reported by the device`);
  const normalized = normalizeConfigItem(raw);
  return { value: String(normalized.value), options: normalized.options ?? [] };
};

export const readU64ConfigItem = (api: RemoteSeekDeviceApi, item: string) =>
  readConfigItem(api, U64_SETTINGS_CATEGORY, item);

/** Every key a seek presses: the fast-forward key, and minus and plus to restart the sub tune. */
const SEEK_KEYS = [FAST_FORWARD_KEY, "minus", "plus"] as const;
type SeekKey = (typeof SEEK_KEYS)[number];

const sendKey = (api: RemoteSeekDeviceApi, transition: "press" | "release", key: SeekKey = FAST_FORWARD_KEY) =>
  api.sendMachineInputBatch({ events: [{ kind: "keyboard", inputs: [key], transition }] });

const sameOption = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const hexAddress = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

type PatchSite = { ldyOperandAddress: number; routine?: PatchRoutine };

/**
 * Write the patch byte, but only while the player's routine is still there: byte for byte as found
 * when the probe recorded it, or else linked up as the player's. Returns false when it is gone.
 */
const writeFastForwardPatch = async (api: RemoteSeekDeviceApi, site: PatchSite, value: number) => {
  const there = site.routine
    ? (await patchRoutineDifferences(api.readMemory, { ...site, routine: site.routine }, null)).length === 0
    : await isFastForwardPatchStillThere(api.readMemory, site.ldyOperandAddress);
  if (!there) return false;
  await api.writeMemory(hexAddress(site.ldyOperandAddress), Uint8Array.of(value));
  return true;
};

/** Undo the patch and read it back. A site that is gone has nothing left to undo. */
const releaseFastForwardPatch = async (api: RemoteSeekDeviceApi, site: PatchSite) => {
  const { ldyOperandAddress } = site;
  if (!(await writeFastForwardPatch(api, site, FAST_FORWARD_RELEASED))) return;
  const [, operand] = await api.readMemory(hexAddress(ldyOperandAddress - 1), 2);
  if (operand !== FAST_FORWARD_RELEASED) throw new Error(`Fast forward patch still reads ${operand} after release`);
};

const releaseSeekKeys = async (api: RemoteSeekDeviceApi) => {
  await api.sendMachineInputBatch({ events: [{ kind: "keyboard", inputs: [...SEEK_KEYS], transition: "release" }] });
  const stillHeld = (await api.getMachineInputState()).keyboard?.inputs ?? [];
  const held = SEEK_KEYS.filter((key) => stillHeld.includes(key));
  if (held.length > 0) throw new Error(`Keys still held after release: ${held.join(", ")}`);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Put the key and the settings back to what the journal recorded, and confirm it by reading them.
 * The key goes first: with it up a raised CPU Speed only speeds the tune's own code, with it down
 * the tune races ahead. Every attempt repeats every step: a step that seemed to fail may have landed.
 */
export const restoreFromJournal = async (
  api: RemoteSeekDeviceApi,
  journal: RemoteSeekJournal,
  reason: string,
  delaysMs: readonly number[] = RESTORE_RETRY_DELAYS_MS,
): Promise<boolean> => {
  let lastError: unknown = null;
  for (const [attempt, delayMs] of delaysMs.entries()) {
    if (delayMs > 0) await sleep(delayMs);
    // The API follows the selected device. Writing these values to a different machine would change
    // a setting nobody asked to change there and leave the one that needs them as it is.
    const connectedKey = api.currentDeviceKey();
    if (connectedKey !== journal.deviceKey) {
      addLog("warn", "Remote seek restore deferred: the app is not connected to that device", {
        reason,
        connectedKey,
        journal,
      });
      return false;
    }
    try {
      const patch = journal.fastForwardPatch ?? null;
      if (patch) await releaseFastForwardPatch(api, patch);
      else await releaseSeekKeys(api);
      // Sound comes back as soon as the tune plays at its own speed again, before the slower config writes.
      const masterVolume = journal.originalMasterVolume ?? null;
      const writes: Array<[category: string, item: string, value: string]> = [];
      if (masterVolume !== null) writes.push([AUDIO_MIXER_CATEGORY, AUDIO_MIXER_MASTER_VOLUME_ITEM, masterVolume]);
      if (journal.cpuSpeedChanged) writes.push([U64_SETTINGS_CATEGORY, CPU_SPEED_ITEM, journal.originalCpuSpeed]);
      if (journal.originalTurboControl !== null)
        writes.push([U64_SETTINGS_CATEGORY, TURBO_CONTROL_ITEM, journal.originalTurboControl]);
      // Only the last write lets a held flash save go: after an earlier one, the others still hold seek values.
      for (const [index, [category, item, value]] of writes.entries()) {
        const last = index === writes.length - 1;
        await api.setConfigValue(
          category,
          item,
          value,
          last ? { __c64uTransientConfigRestore: true } : { __c64uTransientConfigWrite: true },
        );
      }
      const cpuSpeed = journal.cpuSpeedChanged ? await readU64ConfigItem(api, CPU_SPEED_ITEM) : null;
      const turbo = journal.originalTurboControl === null ? null : await readU64ConfigItem(api, TURBO_CONTROL_ITEM);
      const master =
        masterVolume === null ? null : await readConfigItem(api, AUDIO_MIXER_CATEGORY, AUDIO_MIXER_MASTER_VOLUME_ITEM);
      const restored =
        (cpuSpeed === null || sameOption(cpuSpeed.value, journal.originalCpuSpeed)) &&
        (turbo === null || sameOption(turbo.value, journal.originalTurboControl as string)) &&
        (master === null || sameOption(master.value, masterVolume as string));
      if (restored) {
        clearJournalIfOwn(journal);
        addLog("info", "Remote seek restored the device", { reason, attempt, journal });
        return true;
      }
      lastError = new Error(
        `Read-back after restore shows CPU Speed ${cpuSpeed?.value}` +
          (turbo ? `, Turbo Control ${turbo.value}` : "") +
          `; expected ${journal.originalCpuSpeed}` +
          (journal.originalTurboControl ? `, ${journal.originalTurboControl}` : "") +
          (master ? `; Vol Master ${master.value}, expected ${masterVolume}` : ""),
      );
    } catch (error) {
      lastError = error;
    }
    addLog("warn", "Remote seek restore attempt failed", { reason, attempt, journal, ...errorDetails(lastError) });
  }
  addErrorLog("Remote seek could not restore the device; it will retry", {
    reason,
    journal,
    ...errorDetails(lastError),
  });
  restoreFailedListeners.forEach((listener) => listener());
  return false;
};

const restoreFailedListeners = new Set<() => void>();

/** Told when a restore gives up while the app is connected to the device that owes it. Returns an unsubscribe. */
export const onRemoteSeekRestoreFailed = (listener: () => void) => {
  restoreFailedListeners.add(listener);
  return () => void restoreFailedListeners.delete(listener);
};

/** Settings written over REST do not survive a power cycle, which a journal this old has most likely seen. */
export const REMOTE_SEEK_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Replay a journal left by an earlier session for this device. Returns true when nothing is left to undo. */
export const recoverRemoteSeekJournal = async (
  api: RemoteSeekDeviceApi,
  delaysMs: readonly number[] = RESTORE_RETRY_DELAYS_MS,
): Promise<boolean> => {
  const deviceKey = api.currentDeviceKey();
  const journal = deviceKey === null ? null : readRemoteSeekJournal(deviceKey);
  if (!journal) return true;
  if (liveSessions.has(journal.deviceKey)) return true;
  if (Date.now() - journal.startedAtMs > REMOTE_SEEK_JOURNAL_MAX_AGE_MS) {
    // Replaying it now could overwrite settings chosen since; the machine was most likely restarted.
    addLog("warn", "Remote seek dropped an unfinished seek too old to replay", { journal });
    writeJournal(journal.deviceKey, null);
    return true;
  }
  addLog("warn", "Remote seek found an unfinished seek on this device and is undoing it", { journal });
  return restoreFromJournal(api, journal, "recovery", delaysMs);
};

/**
 * One borrow of the device: created before the first change, released by `restore()`. A journal
 * still pending for the same device is replayed first, so its original values are never lost.
 */
export class RemoteSeekDeviceSession {
  private journal: RemoteSeekJournal;
  private currentCpuSpeed: string;
  private restoring: Promise<boolean> | null = null;
  private restored = false;
  private closed = false;
  private muteAttempted = false;
  private muteOnFirstKey = true;
  private readonly inFlight = new Set<Promise<void>>();

  private constructor(
    private readonly api: RemoteSeekDeviceApi,
    journal: RemoteSeekJournal,
    readonly cpuSpeedOptions: string[],
    private readonly fastForward: FastForwardMethod,
    private readonly playerOnScreen: () => Promise<boolean>,
  ) {
    this.journal = journal;
    this.currentCpuSpeed = journal.originalCpuSpeed;
  }

  /**
   * `playerOnScreen` is asked right before every key press and patch write, which go ahead only on
   * yes. `withCpuSpeed: false` is for a machine without CPU Speed, such as the Ultimate-II+(L).
   */
  static async open(
    api: RemoteSeekDeviceApi,
    {
      playerOnScreen,
      fastForward = { kind: "key" },
      withCpuSpeed = true,
    }: { playerOnScreen: () => Promise<boolean>; fastForward?: FastForwardMethod; withCpuSpeed?: boolean },
  ): Promise<RemoteSeekDeviceSession> {
    const deviceKey = api.currentDeviceKey();
    if (deviceKey === null) throw new Error("The connected device has not identified itself");
    // An earlier session still giving this device back (a cancel nobody awaited) finishes first.
    const live = liveSessions.get(deviceKey);
    if (live && !(await live.restore("superseded by a new seek"))) {
      throw new Error("The previous remote seek could not be undone");
    }
    const pending = readRemoteSeekJournal(deviceKey);
    if (pending) {
      const recovered = await restoreFromJournal(api, pending, "before a new seek");
      if (!recovered) throw new Error("The previous remote seek could not be undone");
    }
    const cpuSpeed = withCpuSpeed ? await readU64ConfigItem(api, CPU_SPEED_ITEM) : { value: "", options: [] };
    sessionCounter += 1;
    const journal: RemoteSeekJournal = {
      sessionId: `${Date.now()}-${sessionCounter}`,
      deviceKey,
      originalCpuSpeed: cpuSpeed.value,
      cpuSpeedChanged: false,
      originalTurboControl: null,
      keyHeld: false,
      fastForwardPatch:
        fastForward.kind === "patch"
          ? { ldyOperandAddress: fastForward.ldyOperandAddress, routine: fastForward.routine }
          : null,
      startedAtMs: Date.now(),
    };
    writeJournal(deviceKey, journal);
    const session = new RemoteSeekDeviceSession(api, journal, cpuSpeed.options, fastForward, playerOnScreen);
    liveSessions.set(deviceKey, session);
    return session;
  }

  get deviceKey(): string {
    return this.journal.deviceKey;
  }

  get originalCpuSpeed(): string {
    return this.journal.originalCpuSpeed;
  }

  /** Set CPU Speed, switching Turbo Control to Manual first when it would otherwise ignore the speed. */
  setCpuSpeed(option: string): Promise<void> {
    return this.mutate(async () => {
      if (sameOption(option, this.currentCpuSpeed)) return;
      if (this.cpuSpeedOptions.length === 0) throw new Error("This machine has no CPU Speed to set");
      if (this.journal.originalTurboControl === null) {
        const turbo = await readU64ConfigItem(this.api, TURBO_CONTROL_ITEM);
        if (!sameOption(turbo.value, MANUAL_TURBO_CONTROL)) {
          this.assertOpen();
          this.journal = { ...this.journal, originalTurboControl: turbo.value };
          writeJournal(this.journal.deviceKey, this.journal);
          await this.api.setConfigValue(U64_SETTINGS_CATEGORY, TURBO_CONTROL_ITEM, MANUAL_TURBO_CONTROL, {
            __c64uTransientConfigWrite: true,
          });
        }
      }
      this.assertOpen();
      if (!this.journal.cpuSpeedChanged) {
        this.journal = { ...this.journal, cpuSpeedChanged: true };
        writeJournal(this.journal.deviceKey, this.journal);
      }
      await this.api.setConfigValue(U64_SETTINGS_CATEGORY, CPU_SPEED_ITEM, option, {
        __c64uTransientConfigWrite: true,
      });
      this.currentCpuSpeed = option;
    });
  }

  pressKey(): Promise<void> {
    return this.mutate(async () => {
      await this.muteOnce();
      await this.confirmPlayerFor(FAST_FORWARD_KEY);
      this.journal = { ...this.journal, keyHeld: true };
      writeJournal(this.journal.deviceKey, this.journal);
      if (this.fastForward.kind === "key") {
        await sendKey(this.api, "press");
        return;
      }
      if (!(await writeFastForwardPatch(this.api, this.fastForward, FAST_FORWARD_HELD))) {
        throw new Error("The SID player's keyboard routine is no longer where it was found");
      }
    });
  }

  /** Press and release a key, the way the player's own keys restart the sub tune. */
  tapKey(key: "minus" | "plus", holdMs: number): Promise<void> {
    return this.mutate(async () => {
      if (this.fastForward.kind !== "key") throw new Error("This machine takes no key input");
      await this.muteOnce();
      await this.confirmPlayerFor(key);
      this.journal = { ...this.journal, keyHeld: true };
      writeJournal(this.journal.deviceKey, this.journal);
      await sendKey(this.api, "press", key);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      // A device switch during the hold leaves the release to the restore, which releases every seek key.
      if (this.api.currentDeviceKey() === this.journal.deviceKey) await sendKey(this.api, "release", key);
    });
  }

  /** Release the key on this session's device; on another device there is nothing of ours to release. */
  async releaseKey(): Promise<void> {
    if (this.api.currentDeviceKey() !== this.journal.deviceKey) return;
    if (this.fastForward.kind === "key") await sendKey(this.api, "release");
    else await writeFastForwardPatch(this.api, this.fastForward, FAST_FORWARD_RELEASED);
  }

  /**
   * Give everything back. From the first call on, the session refuses further changes, and the
   * restore waits for any change already on the wire, so nothing can land behind it. Concurrent
   * calls share one restore; a failed restore can be retried by calling again.
   */
  async restore(reason: string): Promise<boolean> {
    this.closed = true;
    if (this.restored) return true;
    this.restoring ??= Promise.allSettled([...this.inFlight])
      .then(() => restoreFromJournal(this.api, this.journal, reason))
      .then((restored) => {
        this.restored = restored;
        this.restoring = null;
        // A journal left behind is recovery's from now on.
        if (liveSessions.get(this.journal.deviceKey) === this) liveSessions.delete(this.journal.deviceKey);
        return restored;
      });
    return this.restoring;
  }

  /**
   * Turn `Vol Master` off before the seek's first key, so neither a restart nor a fast forward is
   * heard, on the speaker or the mirrored stream. The original is journalled first; a machine without
   * `Vol Master`, such as the Ultimate-II+(L), stays as it is.
   */
  /** Whether this seek's first key turns the sound off; the user's setting decides per kind of seek. */
  muteWhenKeysPressed(enabled: boolean) {
    this.muteOnFirstKey = enabled;
  }

  private async muteOnce() {
    if (this.muteAttempted || !this.muteOnFirstKey) return;
    this.muteAttempted = true;
    const master = await readConfigItem(this.api, AUDIO_MIXER_CATEGORY, AUDIO_MIXER_MASTER_VOLUME_ITEM).catch(
      (error) => {
        if (isMissingItem(error)) addLog("debug", "Remote seek: no Vol Master to mute", errorDetails(error));
        else addLog("warn", "Remote seek could not read Vol Master, so it is not muted", errorDetails(error));
        return null;
      },
    );
    const off = master?.options.find((option) => isSidVolumeOffValue(option));
    if (!master || !off || isSidVolumeOffValue(master.value)) return;
    this.assertOpen();
    this.journal = { ...this.journal, originalMasterVolume: master.value };
    writeJournal(this.journal.deviceKey, this.journal);
    await this.api.setConfigValue(AUDIO_MIXER_CATEGORY, AUDIO_MIXER_MASTER_VOLUME_ITEM, off, {
      __c64uTransientConfigWrite: true,
    });
  }

  /**
   * Refuse `key` unless the SID player is on screen right now, and otherwise grant the one press the
   * REST layer will let through (see seekKeyPermit.ts). Outside the player the key would be typed.
   */
  private async confirmPlayerFor(key: string) {
    const onScreen = await this.playerOnScreen();
    this.assertOpen();
    if (!onScreen) throw new RemoteSeekPlayerGoneError(`${key} not pressed: the SID player is no longer on screen`);
    grantSeekKeyPress(this.journal.deviceKey, key);
  }

  private mutate(change: () => Promise<void>): Promise<void> {
    this.assertOpen();
    const running = change();
    this.inFlight.add(running);
    const forget = () => this.inFlight.delete(running);
    running.then(forget, forget);
    return running;
  }

  private assertOpen() {
    if (this.closed) throw new RemoteSeekSessionClosedError();
    // The API follows the selected device; a change meant for this one must not land on another.
    if (this.api.currentDeviceKey() !== this.journal.deviceKey) {
      throw new RemoteSeekSessionClosedError("The app now talks to a different device than this remote seek");
    }
  }
}

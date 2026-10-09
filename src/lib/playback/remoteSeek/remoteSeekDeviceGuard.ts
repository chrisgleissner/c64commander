/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigResponse, MachineInputBatch } from "@/lib/c64api";
import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { addErrorLog, addLog } from "@/lib/logging";
import { remoteSeekErrorDetails as errorDetails, RemoteSeekSessionClosedError } from "./remoteSeekErrors";

export { RemoteSeekSessionClosedError };

/**
 * The device state a remote seek borrows, and the guarantee that it is given back.
 *
 * A remote seek holds the left-arrow key and raises CPU Speed. Neither undoes itself: the firmware
 * keeps a REST-held key down until it is released, and keeps a CPU Speed until it is written again
 * or the machine is power cycled. A user left with a C64 at 64 MHz would find every game and demo
 * broken, so the original values are recorded in a journal BEFORE the first change, the journal is
 * cleared only once a read-back confirms the restore, and a journal left behind by a crash, a lost
 * connection or a killed app is replayed the next time the app reaches that device.
 */

export const U64_SETTINGS_CATEGORY = "U64 Specific Settings";
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
};

export type RemoteSeekJournal = {
  /** Which session wrote it: a restore clears the journal only if it is still its own. */
  sessionId: string;
  deviceKey: string;
  originalCpuSpeed: string;
  cpuSpeedChanged: boolean;
  /** Recorded only when the seek switched Turbo Control, so a restore never writes it needlessly. */
  originalTurboControl: string | null;
  keyHeld: boolean;
  startedAtMs: number;
};

export type ConfigItemSnapshot = { value: string; options: string[] };

type JournalStore = Record<string, RemoteSeekJournal>;

const readJournalStore = (): JournalStore => {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(JOURNAL_STORAGE_KEY);
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

const writeJournal = (deviceKey: string, journal: RemoteSeekJournal | null) => {
  try {
    if (typeof localStorage === "undefined") return;
    const store = readJournalStore();
    if (journal === null) delete store[deviceKey];
    else store[deviceKey] = journal;
    if (Object.keys(store).length === 0) localStorage.removeItem(JOURNAL_STORAGE_KEY);
    else localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    addErrorLog("Remote seek journal could not be written", { ...errorDetails(error), journal });
  }
};

const clearJournalIfOwn = (journal: RemoteSeekJournal) => {
  if (readRemoteSeekJournal(journal.deviceKey)?.sessionId === journal.sessionId) writeJournal(journal.deviceKey, null);
};

/** Sessions open in this process, by device. Their journals are theirs to restore, not recovery's. */
const liveSessions = new Map<string, RemoteSeekDeviceSession>();
let sessionCounter = 0;

/** The current value and options of one U64 Specific Settings item, read from the device itself. */
export const readU64ConfigItem = async (api: RemoteSeekDeviceApi, item: string): Promise<ConfigItemSnapshot> => {
  const response = await api.getConfigItem(U64_SETTINGS_CATEGORY, item, {
    __c64uIntent: "user",
    __c64uBypassCache: true,
  });
  const category = response[U64_SETTINGS_CATEGORY] as Record<string, unknown> | undefined;
  const raw = category?.[item] ?? (category?.items as Record<string, unknown> | undefined)?.[item];
  if (raw === undefined) throw new Error(`${U64_SETTINGS_CATEGORY} / ${item} is not reported by the device`);
  const normalized = normalizeConfigItem(raw);
  return { value: String(normalized.value), options: normalized.options ?? [] };
};

/** Every key a seek presses: the fast-forward key, and minus and plus to restart the sub tune. */
const SEEK_KEYS = [FAST_FORWARD_KEY, "minus", "plus"] as const;
type SeekKey = (typeof SEEK_KEYS)[number];

const sendKey = (api: RemoteSeekDeviceApi, transition: "press" | "release", key: SeekKey = FAST_FORWARD_KEY) =>
  api.sendMachineInputBatch({ events: [{ kind: "keyboard", inputs: [key], transition }] });

const sameOption = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Put the key and the settings back to what the journal recorded, and confirm it by reading them.
 *
 * The key is released first: with the key up a raised CPU Speed only makes the tune's own code
 * faster, while with the key down the tune races ahead. Every attempt repeats every step, because
 * a step that seemed to fail may have landed and a step that seemed to land may not have.
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
      await api.sendMachineInputBatch({
        events: [{ kind: "keyboard", inputs: [...SEEK_KEYS], transition: "release" }],
      });
      const stillHeld = (await api.getMachineInputState()).keyboard?.inputs ?? [];
      const held = SEEK_KEYS.filter((key) => stillHeld.includes(key));
      if (held.length > 0) throw new Error(`Keys still held after release: ${held.join(", ")}`);
      if (journal.cpuSpeedChanged) {
        await api.setConfigValue(U64_SETTINGS_CATEGORY, CPU_SPEED_ITEM, journal.originalCpuSpeed, {
          __c64uTransientConfigRestore: true,
        });
      }
      if (journal.originalTurboControl !== null) {
        await api.setConfigValue(U64_SETTINGS_CATEGORY, TURBO_CONTROL_ITEM, journal.originalTurboControl, {
          __c64uTransientConfigRestore: true,
        });
      }
      const cpuSpeed = journal.cpuSpeedChanged ? await readU64ConfigItem(api, CPU_SPEED_ITEM) : null;
      const turbo = journal.originalTurboControl === null ? null : await readU64ConfigItem(api, TURBO_CONTROL_ITEM);
      const restored =
        (cpuSpeed === null || sameOption(cpuSpeed.value, journal.originalCpuSpeed)) &&
        (turbo === null || sameOption(turbo.value, journal.originalTurboControl as string));
      if (restored) {
        clearJournalIfOwn(journal);
        addLog("info", "Remote seek restored the device", { reason, attempt, journal });
        return true;
      }
      lastError = new Error(
        `Read-back after restore shows CPU Speed ${cpuSpeed?.value}` +
          (turbo ? `, Turbo Control ${turbo.value}` : "") +
          `; expected ${journal.originalCpuSpeed}` +
          (journal.originalTurboControl ? `, ${journal.originalTurboControl}` : ""),
      );
    } catch (error) {
      lastError = error;
    }
    addLog("warn", "Remote seek restore attempt failed", { reason, attempt, journal, ...errorDetails(lastError) });
  }
  addErrorLog("Remote seek could not restore the device; it will retry on the next connection", {
    reason,
    journal,
    ...errorDetails(lastError),
  });
  return false;
};

/** Replay a journal left by an earlier session for this device. Returns true when nothing is left to undo. */
export const recoverRemoteSeekJournal = async (
  api: RemoteSeekDeviceApi,
  delaysMs: readonly number[] = RESTORE_RETRY_DELAYS_MS,
): Promise<boolean> => {
  const deviceKey = api.currentDeviceKey();
  const journal = deviceKey === null ? null : readRemoteSeekJournal(deviceKey);
  if (!journal) return true;
  if (liveSessions.has(journal.deviceKey)) return true;
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
  private readonly inFlight = new Set<Promise<void>>();

  private constructor(
    private readonly api: RemoteSeekDeviceApi,
    journal: RemoteSeekJournal,
    readonly cpuSpeedOptions: string[],
  ) {
    this.journal = journal;
    this.currentCpuSpeed = journal.originalCpuSpeed;
  }

  static async open(api: RemoteSeekDeviceApi): Promise<RemoteSeekDeviceSession> {
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
    const cpuSpeed = await readU64ConfigItem(api, CPU_SPEED_ITEM);
    sessionCounter += 1;
    const journal: RemoteSeekJournal = {
      sessionId: `${Date.now()}-${sessionCounter}`,
      deviceKey,
      originalCpuSpeed: cpuSpeed.value,
      cpuSpeedChanged: false,
      originalTurboControl: null,
      keyHeld: false,
      startedAtMs: Date.now(),
    };
    writeJournal(deviceKey, journal);
    const session = new RemoteSeekDeviceSession(api, journal, cpuSpeed.options);
    liveSessions.set(deviceKey, session);
    return session;
  }

  get originalCpuSpeed(): string {
    return this.journal.originalCpuSpeed;
  }

  get isRestored(): boolean {
    return this.restored;
  }

  /** Set CPU Speed, switching Turbo Control to Manual first when it would otherwise ignore the speed. */
  setCpuSpeed(option: string): Promise<void> {
    return this.mutate(async () => {
      if (sameOption(option, this.currentCpuSpeed)) return;
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
      this.journal = { ...this.journal, keyHeld: true };
      writeJournal(this.journal.deviceKey, this.journal);
      await sendKey(this.api, "press");
    });
  }

  /** Press and release a key, the way the player's own keys restart the sub tune. */
  tapKey(key: "minus" | "plus", holdMs: number): Promise<void> {
    return this.mutate(async () => {
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
    await sendKey(this.api, "release");
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

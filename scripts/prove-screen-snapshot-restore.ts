import { C64API } from "../src/lib/c64api";
import { updateDeviceConnectionState } from "../src/lib/deviceInteraction/deviceStateStore";
import { createSnapshot } from "../src/lib/snapshot/snapshotCreation";
import { decodeSnapshot } from "../src/lib/snapshot/snapshotFormat";
import { clearSnapshotStore, loadSnapshotStore, snapshotEntryToBytes } from "../src/lib/snapshot/snapshotStore";
import { loadMemoryRanges } from "../src/lib/machine/ramOperations";

class MemoryStorage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const ensureBrowserShims = () => {
  const meta = import.meta as ImportMeta & { env?: Record<string, string> };
  if (!meta.env) {
    meta.env = {};
  }
  meta.env.VITE_WEB_PLATFORM ??= "0";

  const eventTarget = new EventTarget();

  if (typeof window === "undefined") {
    Object.assign(globalThis, { window: globalThis });
  }

  Object.assign(window, {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: "http://localhost" },
    Capacitor: { isNativePlatform: () => false },
  });

  if (typeof localStorage === "undefined") {
    Object.assign(globalThis, {
      localStorage: new MemoryStorage(),
    });
  }

  if (typeof sessionStorage === "undefined") {
    Object.assign(globalThis, {
      sessionStorage: new MemoryStorage(),
    });
  }

  if (typeof navigator === "undefined") {
    Object.assign(globalThis, {
      navigator: { userAgent: "node" },
    });
  }

  if (typeof CustomEvent === "undefined") {
    class CustomEventShim<T = unknown> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type, init);
        this.detail = (init?.detail ?? null) as T;
      }
    }

    Object.assign(globalThis, {
      CustomEvent: CustomEventShim,
    });
  }

  Object.assign(globalThis, {
    __APP_VERSION__: "proof",
    __GIT_SHA__: "proof",
    __BUILD_TIME__: new Date().toISOString(),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  });
};

const asHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

const resolveBaseUrl = () => process.env.C64U_BASE_URL ?? `http://${process.env.C64U_HOST ?? "c64u"}`;
const resolveHost = () => process.env.C64U_HOST ?? "c64u";

const main = async () => {
  ensureBrowserShims();
  clearSnapshotStore();
  updateDeviceConnectionState("REAL_CONNECTED");

  const api = new C64API(resolveBaseUrl(), process.env.C64U_PASSWORD, resolveHost());
  const baseline = await api.readMemory("0400", 16);
  console.log(`baseline0400=${asHex(baseline)}`);

  const snapshotResult = await createSnapshot(api, {
    type: "screen",
    label: "proof-screen-snapshot",
    contentName: "proof-screen-snapshot",
  });
  console.log(`snapshotTimestamp=${snapshotResult.displayTimestamp}`);

  const [entry] = loadSnapshotStore();
  if (!entry) {
    throw new Error("No snapshot entry was created");
  }

  console.log(`snapshotType=${entry.snapshotType}`);
  const decoded = decodeSnapshot(snapshotEntryToBytes(entry));
  const ranges = decoded.ranges.map((range, index) => ({
    index,
    start: range.start,
    endExclusive: range.start + range.length,
    size: range.length,
  }));
  console.log(`ranges=${JSON.stringify(ranges)}`);

  const containsScreen = ranges.some((range) => 0x0400 >= range.start && 0x0400 < range.endExclusive);
  console.log(`contains0400=${containsScreen}`);
  if (!containsScreen) {
    throw new Error("Screen snapshot does not cover address $0400 on the live machine");
  }

  const mutated = new Uint8Array([0x54, 0x45, 0x53, 0x54]);
  await api.writeMemory("0400", mutated);
  const afterMutation = await api.readMemory("0400", 16);
  console.log(`afterMutation0400=${asHex(afterMutation)}`);

  await loadMemoryRanges(
    api,
    decoded.ranges.map((range, index) => ({
      start: range.start,
      bytes: decoded.blocks[index],
    })),
  );

  const afterRestore = await api.readMemory("0400", 16);
  console.log(`afterRestore0400=${asHex(afterRestore)}`);

  const restored = asHex(afterRestore) === asHex(baseline);
  console.log(`restored=${restored}`);
  if (!restored) {
    throw new Error("Screen snapshot restore did not restore the baseline bytes at $0400");
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});

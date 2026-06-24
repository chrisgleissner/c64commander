import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/machine/c64Liveness", () => ({
  checkC64Liveness: vi.fn().mockResolvedValue({
    decision: "healthy",
    jiffyAdvanced: true,
    rasterChanged: true,
  }),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: vi.fn(() => ({ correlationId: "test" })),
  getActiveAction: vi.fn(() => null),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordDeviceGuard: vi.fn(),
}));

vi.mock("@/lib/buildInfo", () => ({
  getBuildInfo: () => ({ versionLabel: "1.0.0-test" }),
}));

import { createSnapshot } from "@/lib/snapshot/snapshotCreation";
import { decodeSnapshot } from "@/lib/snapshot/snapshotFormat";
import { clearSnapshotStore, loadSnapshotStore, snapshotEntryToBytes } from "@/lib/snapshot/snapshotStore";
import { loadMemoryRanges } from "@/lib/machine/ramOperations";

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

class MemoryBackedApi {
  readonly memory = new Uint8Array(0x10000);
  pauseCount = 0;
  resumeCount = 0;
  writeCalls: Array<{ address: string; data: Uint8Array }> = [];

  constructor() {
    this.memory[0xdd00] = 0x3f;
    this.memory[0xd018] = 0x15;
    this.memory.fill(0x20, 0x0400, 0x0400 + 1000);
    this.memory.fill(0x0e, 0xd800, 0xd800 + 1000);
  }

  async readMemory(address: string, length: number) {
    const start = parseInt(address, 16);
    return this.memory.slice(start, start + length);
  }

  async writeMemoryBlock(address: string, data: Uint8Array) {
    const start = parseInt(address, 16);
    this.memory.set(data, start);
    this.writeCalls.push({ address, data: data.slice() });
    return { errors: [] };
  }

  async machinePause() {
    this.pauseCount += 1;
    return { errors: [] };
  }

  async machineResume() {
    this.resumeCount += 1;
    return { errors: [] };
  }

  async machineReset() {
    return { errors: [] };
  }

  async machineReboot() {
    return { errors: [] };
  }
}

const ensureBrowserShims = () => {
  const eventTarget = new EventTarget();
  Object.assign(globalThis, {
    window: {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    },
    localStorage: new MemoryStorage(),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  });
};

describe("screen snapshot roundtrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBrowserShims();
    clearSnapshotStore();
  });

  it("roundtrips screen buffer bytes through production snapshot create and restore paths", async () => {
    const api = new MemoryBackedApi();
    const baseline = await api.readMemory("0400", 16);

    await createSnapshot(api as never, {
      type: "screen",
      label: "screen-roundtrip",
      contentName: "screen-roundtrip",
    });

    const [entry] = loadSnapshotStore();
    expect(entry).toBeDefined();
    const decoded = decodeSnapshot(snapshotEntryToBytes(entry!));
    expect(decoded.ranges.some((range) => 0x0400 >= range.start && 0x0400 < range.start + range.length)).toBe(true);

    await api.writeMemoryBlock("0400", new Uint8Array([0x54, 0x45, 0x53, 0x54]));
    expect(Array.from(await api.readMemory("0400", 4))).toEqual([0x54, 0x45, 0x53, 0x54]);

    await loadMemoryRanges(
      api as never,
      decoded.ranges.map((range, index) => ({
        start: range.start,
        bytes: decoded.blocks[index],
      })),
    );

    expect(Array.from(await api.readMemory("0400", 16))).toEqual(Array.from(baseline));
    expect(api.pauseCount).toBe(2);
    expect(api.resumeCount).toBe(2);

    // The restore writes the snapshot's own ranges directly instead of
    // round-tripping the whole $0000-$FFFF image (which corrupted CIA1 timing
    // and sped up the cursor blink). No write covers the full image, the
    // colour RAM is still restored, and no write lands inside a volatile CIA
    // timer/interrupt window.
    const restoreWrites = api.writeCalls.slice(1); // calls[0] is the $0400 mutation above
    expect(restoreWrites.every((c) => c.data.length < 0x10000)).toBe(true);
    expect(restoreWrites.some((c) => c.address === "D800")).toBe(true);
    const intersects = (a: number, len: number, s: number, e: number) => a < e && a + len > s;
    for (const c of restoreWrites) {
      const a = parseInt(c.address, 16);
      expect(intersects(a, c.data.length, 0xdc02, 0xdd00)).toBe(false);
      expect(intersects(a, c.data.length, 0xdd02, 0xde00)).toBe(false);
    }
  });
});

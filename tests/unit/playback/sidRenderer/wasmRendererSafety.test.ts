import { afterEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION } from "libsidplayfp-wasm";
import { WasmSidRendererCore } from "@/lib/playback/sidRenderer/wasmRendererCore";
import { createRendererDispatcher, type SidRendererOpenRequest } from "@/lib/playback/sidRenderer/sidRendererContract";
import type { LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

const instances: FakeEngine[] = [];
class FakeEngine {
  setSystemROMs = vi.fn(async () => undefined);
  loadSidBuffer = vi.fn(async () => undefined);
  renderSeconds = vi.fn(async () => new Int16Array(20));
  seekSeconds = vi.fn(async (seconds: number) => seconds);
  dispose = vi.fn();
  constructor() {
    instances.push(this);
  }
  getSampleRate() {
    return 48000;
  }
  getChannels() {
    return 2;
  }
  getTuneInfo() {
    return null;
  }
}
const cores: WasmSidRendererCore[] = [];
const core = () => {
  const c = new WasmSidRendererCore(async () => FakeEngine);
  cores.push(c);
  return c;
};
const request = (engine: "sidlite" | "residfp" = "sidlite", basic = false): SidRendererOpenRequest => {
  const bytes = new Uint8Array(0x7c);
  bytes.set(new TextEncoder().encode(basic ? "RSID" : "PSID"));
  bytes[5] = 2;
  bytes[0x77] = basic ? 2 : 0;
  return { sidBytes: bytes.buffer, songIndex: 0, sampleRate: 48000, engine };
};
afterEach(() => {
  for (const c of cores.splice(0)) c.dispose();
  instances.length = 0;
});

describe("WASM renderer ROM declarations and fixed engine dependency", () => {
  it("loads the 1.1.1 package containing the SIDLite capacity correction", () => {
    expect(PACKAGE_VERSION).toBe("1.1.1");
  });
  it("reports missing BASIC through the real dispatcher and closes the previous engine", async () => {
    const c = core();
    const messages: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(c, (m) => messages.push(m));
    await dispatch({ type: "open", id: 1, ...request() });
    const previous = instances[0];
    await dispatch({ type: "open", id: 2, ...request("sidlite", true) });
    expect(messages.at(-1)).toMatchObject({ type: "opened", id: 2, romRequired: true });
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(instances).toHaveLength(1);
    expect(await c.render(1)).toBeNull();
  });

  it.each([undefined, 0, 8191])("refuses BASIC playback when the supplied image size is %s", async (size) => {
    const r = request("sidlite", true);
    if (size !== undefined) r.roms = { kernal: new ArrayBuffer(8192), basic: new ArrayBuffer(size) };
    expect(await core().open(r)).toMatchObject({ romRequired: true });
    expect(instances).toHaveLength(0);
  });

  it("allows a declared BASIC program when the BASIC image is supplied", async () => {
    const r = request("sidlite", true);
    r.roms = { kernal: new ArrayBuffer(8192), basic: new ArrayBuffer(8192) };
    const c = core();
    const messages: LocalSidWorkerToMain[] = [];
    await createRendererDispatcher(c, (m) => messages.push(m))({ type: "open", id: 1, ...r });
    expect(messages.at(-1)).toMatchObject({ type: "opened", romRequired: false });
    expect(instances[0].loadSidBuffer).toHaveBeenCalledOnce();
  });

  it("hands KERNAL, BASIC and the character ROM to the engine in that order, on open and pre-render", async () => {
    const roms = { kernal: new ArrayBuffer(8192), basic: new ArrayBuffer(8192), chargen: new ArrayBuffer(4096) };
    new Uint8Array(roms.kernal).fill(1);
    new Uint8Array(roms.basic).fill(2);
    new Uint8Array(roms.chargen).fill(3);
    const c = core();
    await c.open({ ...request(), roms });
    await c.prerender({ ...request(), roms, seconds: 1 }, vi.fn(), () => false);
    for (const instance of instances) {
      const [kernal, basic, chargen] = instance.setSystemROMs.mock.calls[0] as unknown as Uint8Array[];
      expect([kernal[0], kernal.length, basic[0], basic.length, chargen[0], chargen.length]).toEqual([
        1, 8192, 2, 8192, 3, 4096,
      ]);
    }
    expect(instances).toHaveLength(2);
  });

  it("passes null for a character ROM that was never read", async () => {
    const c = core();
    await c.open({ ...request(), roms: { kernal: new ArrayBuffer(8192), basic: new ArrayBuffer(8192) } });
    expect((instances[0].setSystemROMs.mock.calls[0] as unknown[])[2]).toBeNull();
  });

  it("rejects a BASIC pre-render without ROMs before it can emit initialization audio", async () => {
    const onSlice = vi.fn();
    await expect(core().prerender({ ...request("sidlite", true), seconds: 1 }, onSlice, () => false)).rejects.toThrow(
      "BASIC ROM",
    );
    expect(onSlice).not.toHaveBeenCalled();
    expect(instances[0].dispose).toHaveBeenCalledOnce();
  });

  it.each(["sidlite", "residfp"] as const)("uses the fixed library defaults in all three %s paths", async (engine) => {
    const c = core();
    await c.open(request(engine));
    await c.render(1);
    await c.seek(2);
    await c.prerender({ ...request(engine), seconds: 1 }, vi.fn(), () => false);
    expect(instances[0].renderSeconds).toHaveBeenCalledWith(1);
    expect(instances[0].seekSeconds).toHaveBeenCalledWith(2);
    expect(instances[1].renderSeconds).toHaveBeenCalledWith(1);
  });
});

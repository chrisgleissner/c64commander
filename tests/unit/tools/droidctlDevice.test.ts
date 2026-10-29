import { describe, expect, it, vi } from "vitest";
import { setPhoneMediaVolume } from "../../../tools/hil/droidctl_device.mjs";

describe("setPhoneMediaVolume", () => {
  it("does not press volume-up when restoring an already muted zero level", async () => {
    const readVolume = vi.fn().mockResolvedValue({ muted: true, index: 0 });
    const pressVolumeKey = vi.fn();

    await setPhoneMediaVolume({ target: 0, readVolume, pressVolumeKey, wait: vi.fn() });

    expect(readVolume).toHaveBeenCalledTimes(1);
    expect(pressVolumeKey).not.toHaveBeenCalled();
  });
});

describe("setPhoneMediaVolume ceiling", () => {
  const fakePhone = (start: number, startMuted = false) => {
    const state = { index: start, muted: startMuted, highest: start, ups: 0 };
    return {
      state,
      readVolume: async () => ({ muted: state.muted, index: state.index }),
      pressVolumeKey: async (keycode: number) => {
        if (keycode === 24) {
          state.ups += 1;
          if (state.muted) state.muted = false;
          else state.index = Math.min(25, state.index + 1);
        } else {
          state.index = Math.max(0, state.index - 1);
        }
        state.highest = Math.max(state.highest, state.index);
      },
      wait: async () => undefined,
    };
  };

  it("refuses a target above 10 without reading or pressing anything", async () => {
    const phone = fakePhone(5);
    const readVolume = vi.fn(phone.readVolume);

    await expect(setPhoneMediaVolume({ ...phone, readVolume, target: 11 })).rejects.toThrow("ceiling is 10 of 25");

    expect(readVolume).not.toHaveBeenCalled();
    expect(phone.state.ups).toBe(0);
  });

  it("never raises the volume above 10 from any starting level, mute state or target", async () => {
    for (let start = 0; start <= 25; start += 1) {
      for (const muted of [false, true]) {
        for (let target = 0; target <= 10; target += 1) {
          const phone = fakePhone(start, muted);
          await setPhoneMediaVolume({ ...phone, target }).catch(() => undefined);
          expect(phone.state.highest, `start ${start} muted ${muted} target ${target}`).toBeLessThanOrEqual(
            Math.max(start, 10),
          );
        }
      }
    }
  });

  it("steps an already loud phone down to the target instead of raising it", async () => {
    const phone = fakePhone(14);

    await setPhoneMediaVolume({ ...phone, target: 5 });

    expect(phone.state.index).toBe(5);
    expect(phone.state.ups).toBe(0);
  });

  it("does not press volume-up to unmute a phone muted at 10", async () => {
    const phone = fakePhone(10, true);

    await expect(setPhoneMediaVolume({ ...phone, target: 10 })).rejects.toThrow("never raised from 10");

    expect(phone.state.ups).toBe(0);
  });
});

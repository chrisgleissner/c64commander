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

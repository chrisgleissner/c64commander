import { describe, expect, it } from "vitest";
import { loadMockTimingProfile, resolveMockTimingClassId, resolveMockTimingDelayMs } from "../mocks/mockTimingProfile";

describe("mock timing profile", () => {
  it("maps drive endpoints to route-specific timing classes", async () => {
    const profile = await loadMockTimingProfile();

    expect(resolveMockTimingClassId(profile, "GET", "/v1/drives")).toBe("driveListRead");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/b:mount")).toBe("driveMountPut");
    expect(resolveMockTimingClassId(profile, "POST", "/v1/drives/a:mount")).toBe("driveMountPost");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/softiec:reset")).toBe("driveReset");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/printer:on")).toBe("drivePower");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/b:remove")).toBe("driveRemove");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/b:load_rom")).toBe("driveLoadRomPut");
    expect(resolveMockTimingClassId(profile, "POST", "/v1/drives/b:load_rom")).toBe("driveLoadRomPost");
    expect(resolveMockTimingClassId(profile, "PUT", "/v1/drives/b:set_mode")).toBe("driveSetMode");
  });

  it("assigns mount delays much larger than drive power toggles", async () => {
    const profile = await loadMockTimingProfile();

    const mountDelayMs = resolveMockTimingDelayMs({
      profile,
      method: "PUT",
      pathname: "/v1/drives/b:mount",
      requestSequence: 1,
      faultMode: "none",
      latencyOverrideMs: null,
    });
    const powerDelayMs = resolveMockTimingDelayMs({
      profile,
      method: "PUT",
      pathname: "/v1/drives/b:on",
      requestSequence: 1,
      faultMode: "none",
      latencyOverrideMs: null,
    });

    expect(mountDelayMs).toBeGreaterThan(700);
    expect(powerDelayMs).toBeLessThan(25);
    expect(mountDelayMs).toBeGreaterThan(powerDelayMs);
  });
});
import { describe, expect, it } from "vitest";
import { loadMockTimingProfile, resolveMockTimingClassId, resolveMockTimingDelayMs } from "../mocks/mockTimingProfile";

describe("mock timing profile", () => {
  it("covers the documented REST surface with explicit timing classes", async () => {
    const profile = await loadMockTimingProfile();
    const documentedOperations: Array<[string, string, string]> = [
      ["OPTIONS", "/", "optionsRoot"],
      ["GET", "/v1/version", "versionRead"],
      ["GET", "/v1/info", "infoRead"],
      ["PUT", "/v1/runners:sidplay", "runnerSidplayPut"],
      ["POST", "/v1/runners:sidplay", "runnerSidplayPost"],
      ["PUT", "/v1/runners:modplay", "runnerModplayPut"],
      ["POST", "/v1/runners:modplay", "runnerModplayPost"],
      ["PUT", "/v1/runners:load_prg", "runnerLoadPrgPut"],
      ["POST", "/v1/runners:load_prg", "runnerLoadPrgPost"],
      ["PUT", "/v1/runners:run_prg", "runnerRunPrgPut"],
      ["POST", "/v1/runners:run_prg", "runnerRunPrgPost"],
      ["PUT", "/v1/runners:run_crt", "runnerRunCrtPut"],
      ["POST", "/v1/runners:run_crt", "runnerRunCrtPost"],
      ["GET", "/v1/configs", "configsListRead"],
      ["POST", "/v1/configs", "configsBatchWrite"],
      ["GET", "/v1/configs/Audio%20Mixer", "configsCategoryRead"],
      ["GET", "/v1/configs/Audio%20Mixer/Vol%20UltiSid%201", "configsItemRead"],
      ["PUT", "/v1/configs/Audio%20Mixer/Vol%20UltiSid%201", "configsItemWrite"],
      ["PUT", "/v1/configs:load_from_flash", "configsLoadFromFlashWrite"],
      ["PUT", "/v1/configs:save_to_flash", "configsSaveToFlashWrite"],
      ["PUT", "/v1/configs:reset_to_default", "configsResetToDefaultWrite"],
      ["PUT", "/v1/machine:reset", "machineResetWrite"],
      ["PUT", "/v1/machine:reboot", "machineRebootWrite"],
      ["PUT", "/v1/machine:pause", "machinePauseWrite"],
      ["PUT", "/v1/machine:resume", "machineResumeWrite"],
      ["PUT", "/v1/machine:poweroff", "machinePoweroffWrite"],
      ["PUT", "/v1/machine:menu_button", "machineMenuButtonWrite"],
      ["PUT", "/v1/machine:writemem", "machineWritememPut"],
      ["POST", "/v1/machine:writemem", "machineWritememPost"],
      ["GET", "/v1/machine:readmem", "machineReadmemRead"],
      ["GET", "/v1/machine:debugreg", "machineDebugregRead"],
      ["PUT", "/v1/machine:debugreg", "machineDebugregWrite"],
      ["GET", "/v1/drives", "driveListRead"],
      ["PUT", "/v1/drives/b:mount", "driveMountPut"],
      ["POST", "/v1/drives/a:mount", "driveMountPost"],
      ["PUT", "/v1/drives/softiec:reset", "driveReset"],
      ["PUT", "/v1/drives/b:remove", "driveRemove"],
      ["PUT", "/v1/drives/printer:on", "drivePower"],
      ["PUT", "/v1/drives/b:off", "drivePower"],
      ["PUT", "/v1/drives/b:load_rom", "driveLoadRomPut"],
      ["POST", "/v1/drives/b:load_rom", "driveLoadRomPost"],
      ["PUT", "/v1/drives/b:set_mode", "driveSetMode"],
      ["PUT", "/v1/streams/debug:start", "streamStart"],
      ["PUT", "/v1/streams/video:stop", "streamStop"],
      ["GET", "/v1/files/%2FFlash%2Froms%2F1541.rom:info", "fileInfoRead"],
      ["PUT", "/v1/files/%2FUSB2%2Ftest-data%2Fprobe.d64:create_d64", "fileCreateD64"],
      ["PUT", "/v1/files/%2FUSB2%2Ftest-data%2Fprobe.d71:create_d71", "fileCreateD71"],
      ["PUT", "/v1/files/%2FUSB2%2Ftest-data%2Fprobe.d81:create_d81", "fileCreateD81"],
      ["PUT", "/v1/files/%2FUSB2%2Ftest-data%2Fprobe.dnp:create_dnp", "fileCreateDnp"],
    ];

    for (const [method, pathname, expectedClass] of documentedOperations) {
      expect(resolveMockTimingClassId(profile, method, pathname)).toBe(expectedClass);
    }
  });

  it("assigns mount delays much larger than drive power toggles", async () => {
    const profile = await loadMockTimingProfile();

    const realisticMountDelayMs = resolveMockTimingDelayMs({
      profile,
      method: "PUT",
      pathname: "/v1/drives/b:mount",
      requestSequence: 1,
      faultMode: "none",
      timingMode: "realistic",
      latencyOverrideMs: null,
    });
    const realisticPowerDelayMs = resolveMockTimingDelayMs({
      profile,
      method: "PUT",
      pathname: "/v1/drives/b:on",
      requestSequence: 1,
      faultMode: "none",
      timingMode: "realistic",
      latencyOverrideMs: null,
    });
    const fastMountDelayMs = resolveMockTimingDelayMs({
      profile,
      method: "PUT",
      pathname: "/v1/drives/b:mount",
      requestSequence: 1,
      faultMode: "none",
      timingMode: "fast",
      latencyOverrideMs: null,
    });

    expect(realisticMountDelayMs).toBeGreaterThan(700);
    expect(realisticPowerDelayMs).toBeLessThan(25);
    expect(realisticMountDelayMs).toBeGreaterThan(realisticPowerDelayMs);
    expect(fastMountDelayMs).toBeLessThan(100);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceControl, DeviceControlError } from "@/lib/deviceControl/deviceControl";
import { resetActionTrace } from "@/lib/tracing/actionTrace";
import { clearTraceEvents, getTraceEvents } from "@/lib/tracing/traceSession";
import type { C64API } from "@/lib/c64api";

const { addErrorLogSpy } = vi.hoisted(() => ({
  addErrorLogSpy: vi.fn(),
}));

vi.mock("@/lib/logging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logging")>("@/lib/logging");
  return {
    ...actual,
    addErrorLog: addErrorLogSpy,
  };
});

type DeviceControlApi = Pick<C64API, "machineMenuButton" | "machineReboot">;

const createApi = (): DeviceControlApi => ({
  machineMenuButton: vi.fn().mockResolvedValue({ errors: [] }),
  machineReboot: vi.fn().mockResolvedValue({ errors: [] }),
});

describe("deviceControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetActionTrace();
    clearTraceEvents();
  });

  it("alternates menu state across ten consecutive toggles", async () => {
    const api = createApi();
    const control = createDeviceControl({ api: api as C64API });

    const results: boolean[] = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await control.toggleMenu();
      results.push(result.menuOpen);
    }

    expect(results).toEqual([true, false, true, false, true, false, true, false, true, false]);
    expect(api.machineMenuButton).toHaveBeenCalledTimes(10);
    expect(control.getMenuState()).toBe(false);
  });

  it("serializes overlapping menu toggle requests", async () => {
    const api = createApi();
    let resolveFirst: ((value: { errors: [] }) => void) | null = null;
    vi.mocked(api.machineMenuButton)
      .mockImplementationOnce(
        () =>
          new Promise((resolve: (value: { errors: [] }) => void) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ errors: [] });

    const control = createDeviceControl({ api: api as C64API });
    const firstToggle = control.toggleMenu();
    const secondToggle = control.toggleMenu();

    await Promise.resolve();
    expect(api.machineMenuButton).toHaveBeenCalledTimes(1);

    resolveFirst?.({ errors: [] });

    await expect(firstToggle).resolves.toMatchObject({ menuOpen: true });
    await expect(secondToggle).resolves.toMatchObject({ menuOpen: false });
    expect(api.machineMenuButton).toHaveBeenCalledTimes(2);
    expect(control.getMenuState()).toBe(false);
  });

  it("routes keep-ram reboot through REST only", async () => {
    const api = createApi();
    const clearRamAndRebootImpl = vi.fn().mockResolvedValue(undefined);
    const control = createDeviceControl({
      api: api as C64API,
      clearRamAndRebootImpl,
      initialMenuOpen: true,
    });

    const result = await control.rebootKeepRam();

    expect(api.machineReboot).toHaveBeenCalledTimes(1);
    expect(clearRamAndRebootImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      operation: "rebootKeepRam",
      transport: "REST",
      endpoint: "PUT /v1/machine:reboot",
      menuOpen: false,
    });
    expect(control.getMenuState()).toBe(false);

    const transportEvent = getTraceEvents().find(
      (event) => event.type === "device-guard" && event.data.phase === "transport_used",
    );
    expect(transportEvent?.data).toMatchObject({
      operation: "rebootKeepRam",
      transport: "REST",
      endpoint: "PUT /v1/machine:reboot",
    });
  });

  it("uses the full reboot sequence for rebootFull and powerCycle", async () => {
    const api = createApi();
    const clearRamAndRebootImpl = vi.fn().mockResolvedValue(undefined);
    const control = createDeviceControl({
      api: api as C64API,
      clearRamAndRebootImpl,
      initialMenuOpen: true,
    });

    const rebootResult = await control.rebootFull();
    const powerCycleResult = await control.powerCycle();

    expect(clearRamAndRebootImpl).toHaveBeenCalledTimes(2);
    expect(clearRamAndRebootImpl).toHaveBeenNthCalledWith(1, api);
    expect(clearRamAndRebootImpl).toHaveBeenNthCalledWith(2, api);
    expect(api.machineReboot).not.toHaveBeenCalled();
    expect(rebootResult).toMatchObject({
      operation: "rebootFull",
      transport: "REST",
      menuOpen: false,
    });
    expect(powerCycleResult).toMatchObject({
      operation: "powerCycle",
      transport: "REST_FALLBACK_FULL_REBOOT",
      menuOpen: false,
    });
    expect(control.describePowerCycleFallback()).toContain("PUT /v1/machine:pause");
  });

  it("logs structured failures for device-control errors", async () => {
    const api = createApi();
    vi.mocked(api.machineMenuButton).mockResolvedValueOnce({ errors: ["menu jammed"] });
    const control = createDeviceControl({ api: api as C64API });

    await expect(control.toggleMenu()).rejects.toBeInstanceOf(DeviceControlError);

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Device control failed: toggleMenu",
      expect.objectContaining({
        operation: "toggleMenu",
        transport: "REST",
        endpoint: "PUT /v1/machine:menu_button",
        request: expect.objectContaining({
          endpoint: "/v1/machine:menu_button",
          desiredMenuState: "open",
        }),
        errorName: "DeviceControlError",
      }),
    );

    const errorEvent = getTraceEvents().find(
      (event) => event.type === "device-guard" && event.data.phase === "action_result",
    );
    expect(errorEvent?.data).toMatchObject({
      operation: "toggleMenu",
      transport: "REST",
      status: "error",
    });
  });
});

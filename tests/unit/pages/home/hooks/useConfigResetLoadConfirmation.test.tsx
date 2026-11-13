/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConfigResetLoadConfirmation } from "@/pages/home/hooks/useConfigResetLoadConfirmation";

const targetDevice = vi.hoisted(() => ({
  current: { deviceId: "a", multiDevice: false, fullLabel: null as string | null, shortLabel: null },
}));
vi.mock("@/hooks/useTargetDeviceIdentity", () => ({ useTargetDeviceIdentity: () => targetDevice.current }));

const buildHarness = () => {
  const loadConfig = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const resetConfig = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const handleAction = vi.fn(async (action: () => Promise<unknown>) => {
    await action();
  });
  const Harness = () => {
    const confirmation = useConfigResetLoadConfirmation({ handleAction, controls: { loadConfig, resetConfig } });
    return (
      <>
        <button data-testid="load" onClick={confirmation.requestLoad} />
        <button data-testid="reset" onClick={confirmation.requestReset} />
        {confirmation.confirmationDialog}
      </>
    );
  };
  return { Harness, loadConfig, resetConfig, handleAction };
};

describe("useConfigResetLoadConfirmation", () => {
  it("does not load the flash configuration until the confirmation is accepted", () => {
    const { Harness, loadConfig, handleAction } = buildHarness();
    render(<Harness />);

    fireEvent.click(screen.getByTestId("load"));

    expect(screen.getByTestId("machine-action-confirmation")).toHaveTextContent("Load config from flash?");
    expect(screen.getByTestId("machine-action-confirmation")).toHaveTextContent("replaced by the one saved in flash");
    expect(loadConfig.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    expect(handleAction).toHaveBeenCalledWith(expect.any(Function), "Config loaded from flash");
    expect(loadConfig.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("machine-action-confirmation")).not.toBeInTheDocument();
  });

  it("does not reset to firmware defaults until the confirmation is accepted", () => {
    const { Harness, resetConfig, loadConfig } = buildHarness();
    render(<Harness />);

    fireEvent.click(screen.getByTestId("reset"));

    expect(screen.getByTestId("machine-action-confirmation")).toHaveTextContent("Reset config to default?");
    expect(screen.getByTestId("machine-action-confirmation")).toHaveTextContent("firmware default");
    expect(resetConfig.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(resetConfig.mutateAsync).toHaveBeenCalledTimes(1);
    expect(loadConfig.mutateAsync).not.toHaveBeenCalled();
  });

  it("leaves the configuration untouched when the confirmation is canceled", () => {
    const { Harness, resetConfig, loadConfig } = buildHarness();
    render(<Harness />);

    fireEvent.click(screen.getByTestId("reset"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resetConfig.mutateAsync).not.toHaveBeenCalled();
    expect(loadConfig.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("machine-action-confirmation")).not.toBeInTheDocument();
  });

  it("names the target device when several are saved", () => {
    targetDevice.current = { deviceId: "a", multiDevice: true, fullLabel: "Office C64U", shortLabel: null };
    const { Harness } = buildHarness();
    render(<Harness />);

    fireEvent.click(screen.getByTestId("reset"));

    expect(screen.getByTestId("machine-action-confirmation")).toHaveTextContent("on Office C64U");
    targetDevice.current = { deviceId: "a", multiDevice: false, fullLabel: null, shortLabel: null };
  });
});

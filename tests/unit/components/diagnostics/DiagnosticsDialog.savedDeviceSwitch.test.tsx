/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { buildBaseUrlFromDeviceHost, updateC64APIConfig } from "@/lib/c64api";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";
import {
  addSavedDevice,
  completeSavedDeviceVerification,
  getSavedDevicesSnapshot,
  removeSavedDevice,
  selectSavedDevice,
  updateSavedDevice,
} from "@/lib/savedDevices/store";

const { mockVerifyCurrentConnectionTarget } = vi.hoisted(() => ({
  mockVerifyCurrentConnectionTarget: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  verifyCurrentConnectionTarget: mockVerifyCurrentConnectionTarget,
}));

vi.mock("@/lib/query/c64QueryInvalidation", () => ({
  invalidateForSavedDeviceSwitch: vi.fn(),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const healthyHealthState: OverallHealthState = {
  state: "Healthy",
  connectivity: "Online",
  host: "c64u",
  connectedDeviceLabel: "Office U64",
  problemCount: 0,
  contributors: {
    App: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    REST: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    FTP: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    TELNET: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
  },
  lastRestActivity: null,
  lastFtpActivity: null,
  lastTelnetActivity: null,
  primaryProblem: null,
};

const renderInProviders = (ui: ReactNode) =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <DisplayProfileProvider>{ui}</DisplayProfileProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("DiagnosticsDialog saved-device switching", () => {
  let selectedDeviceId: string;
  let backupDeviceId: string;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    updateC64APIConfig(buildBaseUrlFromDeviceHost("c64u:80"), undefined, "c64u:80");

    const snapshot = getSavedDevicesSnapshot();
    selectedDeviceId = snapshot.selectedDeviceId;

    snapshot.devices
      .filter((device) => device.id !== selectedDeviceId)
      .forEach((device) => removeSavedDevice(device.id));

    updateSavedDevice(selectedDeviceId, {
      nickname: "Office U64",
      shortLabel: "Office",
      host: "c64u",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64",
      lastKnownHostname: "office-u64",
      lastKnownUniqueId: "UID-OFFICE",
      hasPassword: false,
    });
    selectSavedDevice(selectedDeviceId);
    completeSavedDeviceVerification(selectedDeviceId, {
      product: "U64",
      hostname: "office-u64",
      unique_id: "UID-OFFICE",
    });

    backupDeviceId = "saved-device-backup";
    addSavedDevice({
      id: backupDeviceId,
      nickname: "Backup Lab",
      shortLabel: "Backup",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });
  });

  afterEach(() => {
    mockVerifyCurrentConnectionTarget.mockReset();
  });

  it("shows local device identity immediately and transitions from verifying to connected after /v1/info succeeds", async () => {
    const verification = createDeferred<{
      ok: boolean;
      deviceInfo: { product: string; hostname: string; unique_id: string };
    }>();
    const onOpenChange = vi.fn();
    mockVerifyCurrentConnectionTarget.mockReturnValueOnce(verification.promise);

    renderInProviders(
      <DiagnosticsDialog
        open
        onOpenChange={onOpenChange}
        healthState={healthyHealthState}
        logs={[]}
        errorLogs={[]}
        traceEvents={[]}
        actionSummaries={[]}
        onShareAll={vi.fn()}
        onShareFiltered={vi.fn()}
        onClearAll={vi.fn()}
        onRetryConnection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("diagnostics-devices-toggle"));
    expect(screen.getByTestId("diagnostics-devices-list")).toBeVisible();

    const backupRow = screen.getByTestId(`diagnostics-device-row-${backupDeviceId}`);
    expect(within(backupRow).getByText("Backup Lab")).toBeVisible();
    expect(backupRow).toHaveTextContent("Last known");

    fireEvent.click(backupRow);

    await waitFor(() => {
      expect(screen.getByTestId(`diagnostics-device-row-${backupDeviceId}`)).toHaveTextContent("Verifying");
    });
    expect(screen.getByTestId(`diagnostics-device-row-${backupDeviceId}`)).toHaveTextContent("Backup");
    expect(onOpenChange).not.toHaveBeenCalled();

    verification.resolve({
      ok: true,
      deviceInfo: {
        product: "U64E",
        hostname: "backup-lab",
        unique_id: "UID-BACKUP",
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(`diagnostics-device-row-${backupDeviceId}`)).toHaveTextContent("Connected");
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

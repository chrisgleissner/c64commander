/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHvscDownloadConsent } from "@/pages/playFiles/hooks/useHvscDownloadConsent";
import { useHvscPreparationLifecycle } from "@/pages/playFiles/hooks/useHvscPreparationLifecycle";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import type { HvscPreparationState } from "@/lib/hvsc";

vi.mock("@/lib/uiErrors", () => ({ reportUserError: vi.fn() }));

describe("collection download consent", () => {
  afterEach(() => saveStartupModeByUser("default"));

  it("SPM-START-02 SID Player asks before a download that has not started", () => {
    saveStartupModeByUser("sid-player");
    const { result } = renderHook(() => useHvscDownloadConsent({ preparationState: "NOT_PRESENT", sheetOpen: true }));
    expect(result.current.awaiting).toBe(true);
    act(() => result.current.grant());
    expect(result.current.awaiting).toBe(false);
  });

  it("SPM-START-02 closing the sheet withdraws consent, so the next opening asks again", () => {
    saveStartupModeByUser("sid-player");
    const { result, rerender } = renderHook(
      ({ open }) => useHvscDownloadConsent({ preparationState: "NOT_PRESENT", sheetOpen: open }),
      { initialProps: { open: true } },
    );
    act(() => result.current.grant());
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.awaiting).toBe(true);
  });

  it("SPM-START-02 a running, failed or finished preparation is not asked about again", () => {
    saveStartupModeByUser("sid-player");
    for (const preparationState of ["DOWNLOADING", "INGESTING", "ERROR", "READY"] as HvscPreparationState[]) {
      const { result } = renderHook(() => useHvscDownloadConsent({ preparationState, sheetOpen: true }));
      expect(result.current.awaiting, preparationState).toBe(false);
    }
  });

  it("SPM-START-02 the Full App never asks and keeps starting the download when the sheet opens", () => {
    const { result } = renderHook(() => useHvscDownloadConsent({ preparationState: "NOT_PRESENT", sheetOpen: true }));
    expect(result.current.awaiting).toBe(false);
  });
});

describe("HVSC preparation lifecycle", () => {
  const hvscFor = (state: HvscPreparationState) => ({
    hvscUpdating: false,
    hvscPreparationState: state,
    runHvscPreparation: vi.fn(async () => undefined),
    handleHvscCancel: vi.fn(async () => undefined),
  });

  it("SPM-START-02 nothing downloads while consent is awaited, and the download starts once it is given", () => {
    const hvsc = hvscFor("NOT_PRESENT");
    const { rerender } = renderHook(
      ({ awaiting }) =>
        useHvscPreparationLifecycle({
          hvsc,
          controlsEnabled: true,
          sheetOpen: true,
          setSheetOpen: vi.fn(),
          awaitingConsent: awaiting,
        }),
      { initialProps: { awaiting: true } },
    );
    expect(hvsc.runHvscPreparation).not.toHaveBeenCalled();

    rerender({ awaiting: false });
    expect(hvsc.runHvscPreparation).toHaveBeenCalledTimes(1);
  });

  it("the sheet closes and a running preparation is cancelled when HVSC is switched off", () => {
    const hvsc = hvscFor("DOWNLOADING");
    const setSheetOpen = vi.fn();
    renderHook(() =>
      useHvscPreparationLifecycle({
        hvsc,
        controlsEnabled: false,
        sheetOpen: true,
        setSheetOpen,
        awaitingConsent: false,
      }),
    );
    expect(setSheetOpen).toHaveBeenCalledWith(false);
    expect(hvsc.handleHvscCancel).toHaveBeenCalledTimes(1);
  });
});

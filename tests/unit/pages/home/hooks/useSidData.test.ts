/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSidData } from "@/pages/home/hooks/useSidData";

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64ConfigItems: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/lib/config/sidDetails", () => ({
  buildSidControlEntries: vi.fn(() => [
    {
      volumeItem: "Vol Socket 1",
      panItem: "Pan Socket 1",
      addressItem: "SID Socket 1 Address",
      volume: "100",
      pan: "0",
      addressRaw: "d400",
    },
  ]),
}));

vi.mock("@/lib/sid/sidSilence", () => ({
  buildSidSilenceTargets: vi.fn(() => []),
}));

describe("useSidData", () => {
  it("uses entry defaults when configOverrides is empty", () => {
    const { result } = renderHook(() => useSidData(true, {}));
    expect(result.current.sidControlEntries[0].volume).toBe("100");
    expect(result.current.sidControlEntries[0].pan).toBe("0");
    expect(result.current.sidControlEntries[0].addressRaw).toBe("d400");
  });

  it("applies configOverrides for volume, pan, and address", () => {
    const overrides = {
      "Audio Mixer::Vol Socket 1": 50,
      "Audio Mixer::Pan Socket 1": 25,
      "SID Addressing::SID Socket 1 Address": "de00",
    };
    const { result } = renderHook(() => useSidData(true, overrides));
    expect(result.current.sidControlEntries[0].volume).toBe("50");
    expect(result.current.sidControlEntries[0].pan).toBe("25");
    expect(result.current.sidControlEntries[0].addressRaw).toBe("de00");
  });
});

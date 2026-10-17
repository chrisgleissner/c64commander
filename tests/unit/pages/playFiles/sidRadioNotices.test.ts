/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { reportStationNotStarted, SID_RADIO_NOTICE_TEXT } from "@/pages/playFiles/sidRadioNotices";

describe("reportStationNotStarted", () => {
  it("toasts the notice even when notifications are set to errors only, because the user just asked for the station", () => {
    reportStationNotStarted("no-radio-for-tune", { reason: "test" });

    expect(toast).toHaveBeenCalledWith({
      title: "SID Radio",
      description: SID_RADIO_NOTICE_TEXT["no-radio-for-tune"],
      alwaysVisible: true,
    });
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { HOME_SUMMARY_QUERY_OPTIONS } from "@/pages/home/constants";

describe("HOME_SUMMARY_QUERY_OPTIONS", () => {
  it("retries a failed Home summary read at most once so an overloaded device is not hammered", () => {
    expect(HOME_SUMMARY_QUERY_OPTIONS.retry).toBeLessThanOrEqual(1);
  });
});

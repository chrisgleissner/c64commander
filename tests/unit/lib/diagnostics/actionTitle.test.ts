/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { humanizeActionName } from "@/lib/diagnostics/actionTitle";

describe("humanizeActionName", () => {
  it("replaces a raw click on a settings section toggle with a readable title", () => {
    expect(humanizeActionName("click settings-section-toggle-diagnostics")).toBe("Tapped settings section diagnostics");
  });

  it("describes a value change with its new value", () => {
    expect(humanizeActionName("change volume-slider [12]")).toBe("Changed volume slider to 12");
  });

  it("keeps names that are already readable", () => {
    expect(humanizeActionName("Save Debug Log")).toBe("Save Debug Log");
    expect(humanizeActionName("click Connected to 192.0.2.13, system healthy")).toBe(
      "click Connected to 192.0.2.13, system healthy",
    );
  });
});

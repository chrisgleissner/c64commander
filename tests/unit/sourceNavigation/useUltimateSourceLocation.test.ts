/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveUltimateSourceName, useUltimateSourceLocation } from "@/lib/sourceNavigation/useUltimateSourceLocation";

describe("resolveUltimateSourceName", () => {
  it("names the source after the connected product", () => {
    expect(resolveUltimateSourceName("Ultimate 64 Elite")).toBe("U64E");
    expect(resolveUltimateSourceName("Ultimate II+L")).toBe("U2");
    expect(resolveUltimateSourceName("C64 Ultimate")).toBe("C64U");
  });

  it("falls back to C64U when the product is unknown", () => {
    expect(resolveUltimateSourceName(null)).toBe("C64U");
    expect(resolveUltimateSourceName("Something else")).toBe("C64U");
  });
});

describe("useUltimateSourceLocation", () => {
  it("builds the Ultimate source with the product name and availability, and keeps it stable across renders", () => {
    const { result, rerender } = renderHook(({ product, available }) => useUltimateSourceLocation(product, available), {
      initialProps: { product: "Ultimate II+L" as string | null, available: false },
    });
    const first = result.current;
    expect(first).toMatchObject({ id: "ultimate", type: "ultimate", name: "U2", isAvailable: false });

    rerender({ product: "Ultimate II+L", available: false });
    expect(result.current).toBe(first);
  });
});

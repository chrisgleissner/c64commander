/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async () => undefined);
vi.mock("@/hooks/useC64Connection", () => ({
  // A new result object on every render, as useMutation returns, holding the same mutateAsync.
  useC64SetConfig: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { useConfigLeafWrite } from "@/pages/config/useConfigLeafWrite";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";

describe("useConfigLeafWrite", () => {
  it("hands every config row the same write function while nothing it depends on changes", () => {
    const authoritativeValues = {
      entriesRef: { current: {} },
      replaceEntry: vi.fn(),
      restoreEntry: vi.fn(),
    } as unknown as AuthoritativeConfigValueState;
    const markChanged = vi.fn();
    const { result, rerender } = renderHook(() => useConfigLeafWrite(authoritativeValues, markChanged));
    const first = result.current.writeLeaf;
    rerender();
    rerender();
    expect(result.current.writeLeaf).toBe(first);
  });
});

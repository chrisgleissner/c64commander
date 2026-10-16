/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBackgroundDueAtSync } from "@/pages/playFiles/hooks/useBackgroundDueAtSync";

type Props = { sessionRestoreSettled: boolean; autoAdvanceDueAtMs: number | null };

describe("useBackgroundDueAtSync", () => {
  // A re-selected Play tab remounts the page with no deadline; the native watchdog kept the playing tune's one.
  it("sends a remounted page's first deadline only once its session is restored", () => {
    const queueBackgroundDueAtUpdate = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      (props: Props) =>
        useBackgroundDueAtSync({
          ...props,
          backgroundExecutionEnabled: true,
          backgroundExecutionActiveRef: { current: true },
          isNativeAndroid: true,
          queueBackgroundDueAtUpdate,
        }),
      { initialProps: { sessionRestoreSettled: false, autoAdvanceDueAtMs: null } },
    );
    expect(queueBackgroundDueAtUpdate).not.toHaveBeenCalled();

    rerender({ sessionRestoreSettled: true, autoAdvanceDueAtMs: 123_456 });

    expect(queueBackgroundDueAtUpdate.mock.calls).toEqual([[123_456]]);
  });
});

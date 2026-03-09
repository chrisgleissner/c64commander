/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfigActionsProvider, useSharedConfigActions } from "@/pages/home/hooks/ConfigActionsContext";

vi.mock("@/pages/home/hooks/useConfigActions", () => ({
  useConfigActions: () => ({
    applyCategory: vi.fn(),
    revertCategory: vi.fn(),
    hasChanges: false,
  }),
}));

function TestConsumer() {
  useSharedConfigActions();
  return null;
}

describe("ConfigActionsContext", () => {
  it("throws when useSharedConfigActions is called outside provider", () => {
    expect(() => render(<TestConsumer />)).toThrow(
      "useSharedConfigActions must be used within a ConfigActionsProvider",
    );
  });

  it("provides context value when inside provider", () => {
    let result: ReturnType<typeof useSharedConfigActions> | undefined;
    function Capturer() {
      result = useSharedConfigActions();
      return null;
    }
    render(
      <ConfigActionsProvider>
        <Capturer />
      </ConfigActionsProvider>,
    );
    expect(result).toBeDefined();
    expect(result).toHaveProperty("applyCategory");
  });
});

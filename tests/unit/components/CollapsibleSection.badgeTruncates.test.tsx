/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Radio } from "lucide-react";

vi.mock("@/components/useHeaderActionsFit", () => ({
  useHeaderActionsFit: () => [
    { section: { current: null }, toggle: { current: null }, actions: { current: null } },
    false,
  ],
}));
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: "compact" }) }));

import { CollapsibleSection } from "@/components/CollapsibleSection";

const renderCard = (badgeTruncates: boolean) =>
  render(
    <CollapsibleSection
      scope="test"
      id="sound"
      title="Sound"
      icon={Radio}
      badge={<span data-testid="badge">A very long name that does not fit beside the title</span>}
      badgeTruncates={badgeTruncates}
      actions={<button data-testid="action">Switch</button>}
    >
      <p>Body</p>
    </CollapsibleSection>,
  );

/** Whether the action sits in the header row, beside the toggle, rather than on a row of its own below it. */
const actionInHeaderRow = () => {
  const toggleRow = screen.getByTestId("test-section-toggle-sound").parentElement;
  return toggleRow?.contains(screen.getByTestId("action")) ?? false;
};

describe("CollapsibleSection with a truncating badge", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the actions in the header row when the header does not fit, and lets the badge truncate", () => {
    renderCard(true);
    expect(actionInHeaderRow()).toBe(true);
    expect(screen.getByTestId("badge").parentElement).toHaveClass("min-w-0", "truncate");
  });

  it("stacks the actions under the header when the badge may not truncate", () => {
    renderCard(false);
    expect(actionInHeaderRow()).toBe(false);
    expect(screen.getByTestId("badge").parentElement).toHaveClass("shrink-0");
  });
});
